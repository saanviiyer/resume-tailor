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
}
