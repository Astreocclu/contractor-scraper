import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function getScoreColor(score) {
  if (score >= 80) return "text-green-500"
  if (score >= 50) return "text-yellow-500"
  return "text-red-500"
}

export function getScoreBgColor(score) {
  if (score >= 80) return "bg-green-500/10 border-green-500/20"
  if (score >= 50) return "bg-yellow-500/10 border-yellow-500/20"
  return "bg-red-500/10 border-red-500/20"
}

export function getTierColor(tier) {
  switch (tier?.toLowerCase()) {
    case 'gold':
      return 'text-yellow-500 bg-yellow-500/10'
    case 'silver':
      return 'text-slate-400 bg-slate-400/10'
    case 'bronze':
      return 'text-amber-700 bg-amber-700/10'
    default:
      return 'text-slate-500 bg-slate-500/10'
  }
}

export function formatPhone(phone) {
  if (!phone) return ''
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return phone
}
