import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/trust-score/explain
 * 
 * This is the "explainTrustScore()" function from the proposal.
 * 
 * FLOW:
 *   User asks a question (e.g. "Why is my trust score 72?")
 *     → This API receives { applicationId, question }
 *     → Calls Fabric API → Blockchain (Org2) → M8 Trust Indexer
 *     → Gets trustScore + trustDetails (integrity, veracity, symmetry)
 *     → LLM-style interpretation engine generates a human-readable explanation
 *     → Returns the explanation to the AI Agent chat UI
 * 
 * WHY THIS APPROACH:
 *   The chaincode already computes trustScore and trustDetails inside getApplication().
 *   We don't just echo "your score is 72". We INTERPRET the three sub-dimensions
 *   (integrity, veracity, symmetry) and the application metadata to explain
 *   exactly WHY the score is what it is.
 */

const FABRIC_API_URL = process.env.NEXT_PUBLIC_FABRIC_API_URL || 'http://localhost:3001';

// ─── Trust Details Interpreter ───────────────────────────────────────────
// This function takes the raw trustDetails from M8 and generates a
// structured, human-readable explanation. In production this would be
// replaced with an actual LLM call (OpenAI / Gemini). For now we use
// a deterministic interpretation engine that maps each dimension's
// value to a contextual explanation — which is MORE reliable for a
// blockchain-anchored system than a hallucinating LLM.

interface TrustData {
  applicationId: string;
  status: string;
  trustScore: number;
  trustDetails: {
    integrity: number;
    veracity: number;
    symmetry: number;
    lastAnalysis: string | null;
  };
  ocrData: {
    extractedOwner: string;
    extractedSurveyNo: string;
    extractedArea: string;
    aiEngine: string;
    processingTime: string;
  } | null;
  ocrMatch: {
    ownerMatch: boolean;
    surveyMatch: boolean;
    confidence: number;
  } | null;
  historyLength: number;
  ownerName: string;
  surveyNumber: string;
  docHash: string | null;
  ipfsHash: string | null;
}

function interpretIntegrity(score: number, docHash: string | null): string {
  if (score >= 100) {
    return `**Integrity: ${score}/100 (Perfect)**\n` +
      `The document fingerprint (SHA-256 hash) stored on the Hyperledger Fabric ledger exactly matches the off-chain document stored on IPFS. ` +
      `This means no tampering has occurred since the document was first anchored to the blockchain.` +
      (docHash ? ` The verified hash is \`${docHash.substring(0, 16)}...\`.` : '');
  }
  if (score >= 70) {
    return `**Integrity: ${score}/100 (Good)**\n` +
      `The on-chain hash largely aligns with the off-chain document, but minor metadata differences were detected. ` +
      `This could be due to a document re-upload or format conversion. The core content remains verified.`;
  }
  return `**Integrity: ${score}/100 (Flagged)**\n` +
    `⚠️ A significant mismatch was detected between the on-chain cryptographic anchor and the current off-chain document. ` +
    `This triggers the Automated Fraud Detection Engine. The application has been flagged for manual review.`;
}

function interpretVeracity(score: number, historyLength: number): string {
  if (score >= 100) {
    return `**Veracity: ${score}/100 (Fully Verified)**\n` +
      `Both the Registration Department (Org1) and Revenue Department (Org2) have formally endorsed this record. ` +
      `The multi-signature endorsement verification confirms ${historyLength} verification events in the application history.`;
  }
  if (score >= 70) {
    return `**Veracity: ${score}/100 (Partially Verified)**\n` +
      `The application has ${historyLength} history events, but has not yet received endorsements from all required departments. ` +
      `The score of ${score} indicates that while some organizational approvals are in place, ` +
      `full cross-departmental consensus has not been achieved yet. As more officials verify, this score will increase.`;
  }
  return `**Veracity: ${score}/100 (Low Verification)**\n` +
    `The application has minimal verification history (${historyLength} events). ` +
    `No multi-signature endorsement has been recorded from the required departments. ` +
    `This typically means the application is still in early processing stages.`;
}

function interpretSymmetry(score: number, ocrMatch: TrustData['ocrMatch']): string {
  if (score >= 90) {
    return `**Symmetry: ${score}/100 (Excellent Match)**\n` +
      `The AI-OCR engine (M9) extracted text from the uploaded documents and compared it against the user-provided input. ` +
      `A ${score}% match was found.` +
      (ocrMatch ? ` Owner name: ${ocrMatch.ownerMatch ? '✅ Match' : '❌ Mismatch'}. Survey number: ${ocrMatch.surveyMatch ? '✅ Match' : '❌ Mismatch'}. OCR confidence: ${ocrMatch.confidence}%.` : '');
  }
  if (score >= 70) {
    return `**Symmetry: ${score}/100 (Acceptable Match)**\n` +
      `The AI-OCR analysis found a ${score}% match between extracted document data and user input. ` +
      `Minor discrepancies may exist due to OCR interpretation of handwritten text or regional language variations.`;
  }
  return `**Symmetry: ${score}/100 (Poor Match)**\n` +
    `⚠️ Significant discrepancies detected between the document content and user-submitted data. ` +
    `This could indicate data entry errors or document substitution. Additional review is recommended.`;
}

function getOverallAssessment(trustScore: number, status: string): string {
  if (trustScore >= 90) {
    return `🟢 **Overall Assessment: EXCEPTIONAL TRUST**\n` +
      `This application demonstrates the highest level of blockchain-verified integrity. ` +
      `All three trust dimensions (Integrity, Veracity, Symmetry) are performing strongly. ` +
      `The application is safe for automated approval at the current stage (${formatStatus(status)}).`;
  }
  if (trustScore >= 75) {
    return `🔵 **Overall Assessment: VERIFIED — SAFE FOR PROCESSING**\n` +
      `The trust index indicates a reliable application. The composite score of ${trustScore.toFixed(1)} ` +
      `places this in the "verified" tier. Normal processing can continue at stage: ${formatStatus(status)}.`;
  }
  if (trustScore >= 50) {
    return `🟡 **Overall Assessment: NEUTRAL — REVIEW RECOMMENDED**\n` +
      `The trust index of ${trustScore.toFixed(1)} suggests some areas need attention. ` +
      `While no fraud flags have been raised, one or more trust dimensions are below optimal levels. ` +
      `A manual review is recommended before advancing from stage: ${formatStatus(status)}.`;
  }
  return `🔴 **Overall Assessment: HIGH RISK — INTEGRITY ALERT**\n` +
    `The trust index of ${trustScore.toFixed(1)} has triggered the Automated Fraud Detection Engine. ` +
    `One or more critical trust dimensions have failed verification. ` +
    `This application should NOT be advanced from stage: ${formatStatus(status)} until a thorough manual investigation is completed.`;
}

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'submitted': 'Submitted (Awaiting Clerk)',
    'with_clerk': 'With Clerk',
    'with_superintendent': 'With Superintendent',
    'with_project_officer': 'With Project Officer',
    'with_revenue_dept': 'With Revenue Department',
    'with_mro': 'With MRO',
    'with_surveyor': 'With Surveyor',
    'with_revenue_inspector': 'With Revenue Inspector',
    'with_vro': 'With VRO',
    'with_revenue_dept_officer': 'With Revenue Dept Officer',
    'with_joint_collector': 'With Joint Collector',
    'with_collector': 'With District Collector',
    'approved': 'Approved',
    'completed': 'Completed',
    'rejected': 'Rejected',
  };
  return statusMap[status] || status;
}

function generateExplanation(trustData: TrustData, question: string): string {
  const { trustScore, trustDetails, ocrMatch, historyLength, docHash, applicationId, status, ownerName, surveyNumber } = trustData;

  // Build the contextual explanation
  let explanation = '';

  explanation += `## Trust Score Analysis for ${applicationId}\n\n`;
  explanation += `**Applicant:** ${ownerName} | **Survey:** ${surveyNumber} | **Stage:** ${formatStatus(status)}\n\n`;
  explanation += `---\n\n`;

  // The composite trust score
  explanation += `### 📊 Composite Trust Score: **${trustScore.toFixed(1)} / 100**\n\n`;
  explanation += `This score is computed by the M8 Trust Indexer using a **Weighted Composite Scoring Algorithm** `;
  explanation += `that evaluates three independent dimensions from blockchain telemetry:\n\n`;

  // Break down each dimension
  explanation += `---\n\n`;
  explanation += `### Dimension Breakdown\n\n`;
  explanation += interpretIntegrity(trustDetails.integrity, docHash) + '\n\n';
  explanation += interpretVeracity(trustDetails.veracity, historyLength) + '\n\n';
  explanation += interpretSymmetry(trustDetails.symmetry, ocrMatch) + '\n\n';

  // Overall assessment
  explanation += `---\n\n`;
  explanation += getOverallAssessment(trustScore, status) + '\n\n';

  // If the user asked a specific question, add contextual response
  const lowerQuestion = question.toLowerCase();
  if (lowerQuestion.includes('why') || lowerQuestion.includes('reason')) {
    explanation += `---\n\n`;
    explanation += `### 💬 In response to your question\n\n`;
    explanation += `The score of **${trustScore.toFixed(1)}** is derived from:\n`;
    explanation += `- **Integrity** contributes ${trustDetails.integrity >= 90 ? 'positively' : 'partially'} (${trustDetails.integrity}/100)\n`;
    explanation += `- **Veracity** contributes ${trustDetails.veracity >= 90 ? 'positively' : 'partially'} (${trustDetails.veracity}/100) — ${historyLength > 2 ? 'multiple verifications recorded' : 'limited verification history'}\n`;
    explanation += `- **Symmetry** contributes ${trustDetails.symmetry >= 90 ? 'positively' : 'partially'} (${trustDetails.symmetry}/100) — ${trustDetails.symmetry >= 90 ? 'OCR data closely matches input' : 'some OCR discrepancies found'}\n`;
  }

  if (lowerQuestion.includes('improve') || lowerQuestion.includes('increase') || lowerQuestion.includes('better')) {
    explanation += `\n---\n\n`;
    explanation += `### 📈 How to Improve the Trust Score\n\n`;
    if (trustDetails.veracity < 100) {
      explanation += `1. **Get more departmental verifications** — Each official endorsement from Org1 (Registration) and Org2 (Revenue) increases the Veracity score.\n`;
    }
    if (trustDetails.symmetry < 95) {
      explanation += `2. **Ensure document data matches input** — Re-verify that the uploaded document content matches the data you entered during application submission.\n`;
    }
    if (!docHash) {
      explanation += `3. **Upload verified documents** — Documents anchored via DigiLocker verification receive full Integrity scores.\n`;
    }
    explanation += `4. **Progress through approval stages** — Applications that advance to higher-level officials (Joint Collector, District Collector) automatically receive higher trust bonuses.\n`;
  }

  if (lowerQuestion.includes('fraud') || lowerQuestion.includes('flag') || lowerQuestion.includes('risk')) {
    explanation += `\n---\n\n`;
    explanation += `### 🛡️ Fraud Detection Status\n\n`;
    if (trustDetails.integrity >= 100) {
      explanation += `No fraud flags have been raised. The SHA-256 hash verification between on-chain and off-chain data has passed. The Automated Integrity Guard confirms document authenticity.\n`;
    } else {
      explanation += `⚠️ The Integrity Guard has detected potential issues. A hash mismatch between the ledger-anchored fingerprint and the current document may indicate tampering. Manual review is required.\n`;
    }
  }

  if (trustDetails.lastAnalysis) {
    explanation += `\n---\n*Last analysis timestamp: ${new Date(parseInt(trustDetails.lastAnalysis) * 1000).toLocaleString()}*\n`;
  }

  return explanation;
}

// ─── API Handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { applicationId, question } = body;

    if (!applicationId) {
      return NextResponse.json(
        { error: 'Application ID is required' },
        { status: 400 }
      );
    }

    if (!question) {
      return NextResponse.json(
        { error: 'A question is required' },
        { status: 400 }
      );
    }

    // ─── Step 1: Call Fabric API → Blockchain (Org2) → M8 Trust Indexer ───
    const fabricResponse = await fetch(
      `${FABRIC_API_URL}/api/land/applications/${applicationId}/trust-score`
    );

    if (!fabricResponse.ok) {
      const errData = await fabricResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error || 'Failed to fetch trust data from blockchain' },
        { status: fabricResponse.status }
      );
    }

    const fabricResult = await fabricResponse.json();

    if (!fabricResult.success || !fabricResult.data) {
      return NextResponse.json(
        { error: 'No trust data returned from M8 Trust Indexer' },
        { status: 404 }
      );
    }

    const trustData: TrustData = fabricResult.data;

    // ─── Step 2: LLM-style Interpretation ────────────────────────────────
    // Generate a rich, contextual explanation from the raw trust metrics
    const explanation = generateExplanation(trustData, question);

    // ─── Step 3: Return to the AI Agent chat UI ──────────────────────────
    return NextResponse.json({
      success: true,
      trustScore: trustData.trustScore,
      trustDetails: trustData.trustDetails,
      explanation,
      metadata: {
        applicationId: trustData.applicationId,
        status: trustData.status,
        ownerName: trustData.ownerName,
        surveyNumber: trustData.surveyNumber,
      }
    });

  } catch (error) {
    console.error('explainTrustScore error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to explain trust score' },
      { status: 500 }
    );
  }
}
