import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICIES, formatScore, grade, type GradeItem } from '../src/scoring.ts';

const policy = POLICIES['kr-qnet-written-v1'];
const item = (subjectId: string, answers: number[], selected: number | null): GradeItem => ({ subjectId, subjectName: subjectId, answers, selected });

test('1/40 정답은 어디서나 2.5로 표시 (COMCBT 2점/3점 불일치 회귀)', () => {
  const items = [item('a', [2], 2), item('a', [1], 2), ...Array.from({ length: 38 }, () => item('a', [1], null))];
  const r = grade(items, policy, true);
  assert.equal(r.raw, 2.5);
  assert.equal(r.display, '2.5');
  assert.deepEqual([r.correct, r.wrong, r.unanswered], [1, 1, 38]);
});

test('formatScore: 소수 첫째 자리 반올림, 정수는 소수점 없음', () => {
  assert.equal(formatScore(60), '60');
  assert.equal(formatScore(66.666), '66.7');
  assert.equal(formatScore(2.45), '2.5');
});

test('평균 60 이상이어도 한 과목 40 미만이면 과락 불합격', () => {
  const items = [
    ...Array.from({ length: 5 }, () => item('a', [1], 1)),
    ...Array.from({ length: 5 }, () => item('b', [1], 1)),
    ...[1, 1, 2, 2, 2].map(s => item('c', [1], s)), // 40점: 과락 아님
    ...[1, 2, 2, 2, 2].map(s => item('d', [1], s)), // 20점: 과락
  ];
  const r = grade(items, policy, true);
  assert.equal(r.display, '65');
  assert.equal(r.subjects.find(s => s.subjectId === 'd')!.failed, true);
  assert.equal(r.subjects.find(s => s.subjectId === 'c')!.failed, false);
  assert.equal(r.verdict, 'fail');
});

test('전 과목 40 이상, 평균 60 이상이면 합격', () => {
  const items = [...[1, 1, 1, 2, 2].map(s => item('a', [1], s)), ...[1, 1, 1, 1, 2].map(s => item('b', [1], s))];
  assert.equal(grade(items, policy, true).verdict, 'pass'); // 60, 80 → 70
});

test('복수정답·전원정답 처리', () => {
  const r = grade([item('a', [1, 3], 3), item('a', [], null)], policy, true);
  assert.equal(r.correct, 2);
});

test('일부 문항 재풀이(complete=false)는 합격 판정을 내리지 않음', () => {
  const r = grade([item('a', [1], 1)], policy, false);
  assert.equal(r.verdict, null);
  assert.equal(r.display, null);
});
