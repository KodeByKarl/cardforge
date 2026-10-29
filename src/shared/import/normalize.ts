import type { FieldKind } from '../types'

// Zero-width characters and non-breaking spaces that commonly sneak in via copy/paste from web pages or Word.
const INVISIBLE = /[​-‍⁠﻿]/g
const NBSP = /[  ]/g

/** Trims, NFC-normalises, removes invisible characters, and collapses runs of spaces. */
export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(INVISIBLE, '').replace(NBSP, ' ').replace(/[ \t]+/g, ' ').trim()
}

/** Like normalizeText, but keeps line breaks (one per line, each trimmed, blank lines dropped). */
export function normalizeMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(normalizeText)
    .filter((line) => line.length > 0)
    .join('\n')
}

export function normalizeEmail(value: string): string {
  return normalizeText(value).replace(/^mailto:/i, '').toLowerCase()
}

/**
 * Phone formats are client-specific, so we never reformat digits — we only clean whitespace.
 * Multiple numbers on separate lines become " / "-separated.
 */
export function normalizePhone(value: string): string {
  return normalizeMultiline(value).replace(/\n/g, ' / ')
}

export function normalizeValue(value: string, kind: FieldKind): string {
  switch (kind) {
    case 'email':
      return normalizeEmail(value)
    case 'phone':
      return normalizePhone(value)
    case 'multiline':
      return normalizeMultiline(value)
    case 'text':
      return normalizeText(value.replace(/\r?\n/g, ' '))
  }
}

// Deliberately permissive: catches typos like missing "@" or domain, not every RFC 5322 edge case.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}

// Digits plus the separators people actually write: + ( ) - . / space, and "ext"/"loc" extensions.
const PHONE_PATTERN = /^[+(\d][\d\s()./-]*(\s*(ext|loc|local|x)\.?\s*\d+)?$/i

export function isPlausiblePhone(value: string): boolean {
  return value.split(' / ').every((part) => {
    const digits = part.replace(/\D/g, '')
    return PHONE_PATTERN.test(part.trim()) && digits.length >= 5
  })
}
