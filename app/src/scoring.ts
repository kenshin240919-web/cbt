// 채점 정책과 점수 표시 규칙. 점수 표시는 반드시 formatScore 하나만 사용한다
// (결과·목록·CSV가 다른 반올림을 쓰는 문제 방지).

export const GRADER_VERSION = 'grader-1';

export type ScoringPolicy = {
  id: string;
  subjectCutoff: number; // 과목 과락 기준(미만이면 과락)
  passAverage: number; // 전 과목 평균 합격 기준(이상이면 합격)
};

export const POLICIES: Record<string, ScoringPolicy> = {
  // 국가기술자격 필기 일반 기준: 과목당 40점 이상, 전 과목 평균 60점 이상
  'kr-qnet-written-v1': { id: 'kr-qnet-written-v1', subjectCutoff: 40, passAverage: 60 },
};

export type GradeItem = {
  subjectId: string;
  subjectName: string;
  answers: number[]; // 정답 보기 번호(복수정답 허용). 빈 배열 = 전원정답
  selected: number | null;
};

export type SubjectScore = {
  subjectId: string;
  name: string;
  total: number;
  correct: number;
  raw: number;
  display: string;
  failed: boolean;
};

export type GradeResult = {
  subjects: SubjectScore[];
  raw: number | null;
  display: string | null;
  verdict: 'pass' | 'fail' | null;
  correct: number;
  wrong: number;
  unanswered: number;
};

export function formatScore(raw: number): string {
  const rounded = Math.round(raw * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function isCorrect(answers: number[], selected: number | null): boolean {
  if (answers.length === 0) return true;
  return selected !== null && answers.includes(selected);
}

// complete=false(오답 다시 풀기처럼 일부 문항만 푼 경우)이면 합격 판정을 내리지 않는다
export function grade(items: GradeItem[], policy: ScoringPolicy, complete: boolean): GradeResult {
  const bySubject = new Map<string, { name: string; total: number; correct: number }>();
  let correct = 0;
  let wrong = 0;
  let unanswered = 0;

  for (const item of items) {
    const s = bySubject.get(item.subjectId) ?? { name: item.subjectName, total: 0, correct: 0 };
    s.total++;
    if (isCorrect(item.answers, item.selected)) {
      s.correct++;
      correct++;
    } else if (item.selected === null) {
      unanswered++;
    } else {
      wrong++;
    }
    bySubject.set(item.subjectId, s);
  }

  const subjects: SubjectScore[] = [...bySubject].map(([subjectId, s]) => {
    const raw = (s.correct / s.total) * 100;
    return { subjectId, name: s.name, total: s.total, correct: s.correct, raw, display: formatScore(raw), failed: raw < policy.subjectCutoff };
  });

  if (!complete || subjects.length === 0) {
    return { subjects, raw: null, display: null, verdict: null, correct, wrong, unanswered };
  }

  const raw = subjects.reduce((sum, s) => sum + s.raw, 0) / subjects.length;
  const verdict = raw >= policy.passAverage && subjects.every(s => !s.failed) ? 'pass' : 'fail';
  return { subjects, raw, display: formatScore(raw), verdict, correct, wrong, unanswered };
}
