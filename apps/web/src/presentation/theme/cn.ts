/**
 * className 合并：clsx（条件） + tailwind-merge（去冲突）。
 * 所有组件都用它，避免出现 `bg-brand bg-surface` 这类互相打架的类。
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
