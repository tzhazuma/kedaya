/**
 * 找搭子 · 问卷题型的校验与答案规整（规格 §2.6）
 *
 * 移植 STUMatch 的校验器
 * （`/tmp/stumatch-ref/services/backend/unimatch/routers/questionnaires.py:30-107`），
 * 保留同样的题型集合：`single_choice` / `multiple_choice` / `rating` / `text`。
 *
 * ## 为什么题目存 DB 而校验在代码里
 *
 * 题目（选项、上下限）是**运营数据**，改题不该发版；
 * 而"答案必须符合题目声明"是**校验逻辑**，不该让运营通过改 JSON 绕过。
 * 两者分离：运营改题 → 校验规则随之生效；运营无法改出"没有校验的题"。
 *
 * ## `required` 的处理
 *
 * 缺 `required: true` 的题不填就是合法的（`undefined` 不进 `answers`）。
 * 显式传 `null` 与"没传"视为等价（都不算填了）——
 * 小程序端把输入框清空会发 `null`，这不是用户"填了空值"的意思。
 */

export type QuestionType = 'single_choice' | 'multiple_choice' | 'rating' | 'text';

export interface ChoiceQuestion {
  id: string;
  type: 'single_choice' | 'multiple_choice';
  required?: boolean;
  options: Array<{ value: string; label: string }>;
}

export interface RatingQuestion {
  id: string;
  type: 'rating';
  required?: boolean;
  min: number;
  max: number;
}

export interface TextQuestion {
  id: string;
  type: 'text';
  required?: boolean;
  maxLength: number;
}

export type Question = ChoiceQuestion | RatingQuestion | TextQuestion;

export interface AnswerValidation {
  ok: boolean;
  /** 规整后的答案（只含合法题目的合法值） */
  answers: Record<string, unknown>;
  /** 字段级错误：`questionId` → 中文原因 */
  errors: Array<{ questionId: string; reason: string }>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析题目数组。非法题目**整体拒绝**（宁可让运营改对 JSON，也不要静默忽略一道题） */
export function parseQuestions(raw: unknown): { ok: true; questions: Question[] } | { ok: false; reason: string } {
  if (!Array.isArray(raw)) return { ok: false, reason: 'questions 不是数组' };

  const questions: Question[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!isPlainObject(item)) return { ok: false, reason: '题目不是对象' };
    const id = item.id;
    const type = item.type;
    if (typeof id !== 'string' || id.length === 0) return { ok: false, reason: '题目缺少 id' };
    if (seen.has(id)) return { ok: false, reason: `题目 id 重复：${id}` };
    seen.add(id);

    const required = item.required === true;

    if (type === 'single_choice' || type === 'multiple_choice') {
      if (!Array.isArray(item.options) || item.options.length === 0) {
        return { ok: false, reason: `题目 ${id} 缺少 options` };
      }
      const options: Array<{ value: string; label: string }> = [];
      for (const option of item.options) {
        if (!isPlainObject(option) || typeof option.value !== 'string') {
          return { ok: false, reason: `题目 ${id} 的选项缺少 value` };
        }
        options.push({ value: option.value, label: typeof option.label === 'string' ? option.label : option.value });
      }
      questions.push({ id, type, required, options });
      continue;
    }

    if (type === 'rating') {
      if (typeof item.min !== 'number' || typeof item.max !== 'number' || item.max <= item.min) {
        return { ok: false, reason: `题目 ${id} 的 min/max 不合法` };
      }
      questions.push({ id, type, required, min: item.min, max: item.max });
      continue;
    }

    if (type === 'text') {
      if (typeof item.maxLength !== 'number' || item.maxLength <= 0) {
        return { ok: false, reason: `题目 ${id} 缺少 maxLength` };
      }
      questions.push({ id, type, required, maxLength: item.maxLength });
      continue;
    }

    return { ok: false, reason: `题目 ${id} 的类型不支持：${String(type)}` };
  }

  return { ok: true, questions };
}

/**
 * 校验并规整答案。
 *
 * **未知题目 id 被丢弃**（不报错）：题目可能已被运营下架，
 * 而用户手里还是旧版本的小程序。丢弃比拒绝更符合"别让用户修不好"的原则。
 */
export function validateAnswers(questions: readonly Question[], raw: unknown): AnswerValidation {
  const errors: Array<{ questionId: string; reason: string }> = [];
  const answers: Record<string, unknown> = {};

  if (raw === undefined || raw === null) raw = {};
  if (!isPlainObject(raw)) {
    return { ok: false, answers, errors: [{ questionId: '*', reason: 'answers 不是对象' }] };
  }

  for (const question of questions) {
    // 先取出 id：`switch` 的穷尽性检查会把 `question` 收窄成 `never`，
    // 在 `default` 分支里再访问 `question.id` 会编译报错。
    const questionId = question.id;
    const value = (raw as Record<string, unknown>)[questionId];
    const missing = value === undefined || value === null;

    if (missing) {
      if (question.required) errors.push({ questionId, reason: '必填' });
      continue;
    }

    switch (question.type) {
      case 'single_choice': {
        const allowed = question.options.map((option) => option.value);
        if (typeof value !== 'string' || !allowed.includes(value)) {
          errors.push({ questionId, reason: '不是合法选项' });
          break;
        }
        answers[questionId] = value;
        break;
      }
      case 'multiple_choice': {
        if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
          errors.push({ questionId, reason: '不是字符串数组' });
          break;
        }
        const allowed = new Set(question.options.map((option) => option.value));
        const bad = (value as string[]).filter((item) => !allowed.has(item));
        if (bad.length > 0) {
          errors.push({ questionId, reason: `含非法选项：${bad.join(',')}` });
          break;
        }
        answers[questionId] = [...new Set(value as string[])];
        break;
      }
      case 'rating': {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push({ questionId, reason: '不是整数' });
          break;
        }
        if (value < question.min || value > question.max) {
          errors.push({ questionId, reason: `必须在 ${question.min}–${question.max} 之间` });
          break;
        }
        answers[questionId] = value;
        break;
      }
      case 'text': {
        if (typeof value !== 'string') {
          errors.push({ questionId, reason: '不是字符串' });
          break;
        }
        if (value.length > question.maxLength) {
          errors.push({ questionId, reason: `超过 ${question.maxLength} 字` });
          break;
        }
        answers[questionId] = value;
        break;
      }
      default:
        errors.push({ questionId, reason: '未知题型' });
    }
  }

  return { ok: errors.length === 0, answers, errors };
}
