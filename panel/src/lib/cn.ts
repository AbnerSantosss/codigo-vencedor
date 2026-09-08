import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Junta classes e resolve conflitos do Tailwind (o último ganha). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
