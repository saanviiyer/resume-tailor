export interface Review {
  matchScore: number;
  strengths: string[];
  gaps: string[];
  suggestions: string[];
}

export interface SupplementalAnswer {
  question: string;
  answer: string;
}

export interface GenerateResult {
  review: Review;
  tailoredResume: string;
  supplementalAnswers: SupplementalAnswer[];
}

export interface GenerateResponse {
  mockMode: boolean;
  result: GenerateResult;
  // Remaining daily generations (Supabase mode); null in anonymous mode.
  remaining: number | null;
}

// GET /api/health
export interface ServerInfo {
  ok: boolean;
  mockMode: boolean;
  model: string;
  supabaseEnabled: boolean;
  dailyCap: number;
}

// A persisted application row returned by GET /api/applications.
export interface Application {
  id: string;
  job_title: string | null;
  job_url: string | null;
  result: GenerateResult;
  mock_mode: boolean;
  created_at: string;
}
