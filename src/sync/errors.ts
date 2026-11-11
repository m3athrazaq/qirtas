// Server and network errors in words the user can act on (the raw ones are English and technical).
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { t } from '../lib/i18n'

export function isNetworkError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err ?? '')
  return isAuthRetryableFetchError(err) || /failed to fetch|networkerror|load failed|network request failed|fetch failed|err_name_not_resolved|err_internet/i.test(msg)
}

export function friendlyError(err: unknown): string {
  const msg = String((err as { message?: unknown })?.message ?? err ?? '')
  const status = (err as { status?: number })?.status
  if (isNetworkError(err)) return t('errNetwork')
  if (/invalid login credentials/i.test(msg)) return t('errCredentials')
  if (/already registered|already been registered|user already exists/i.test(msg)) return t('errExists')
  if (/email not confirmed/i.test(msg)) return t('errNotConfirmed')
  if (/password should be at least|weak password|password is too short/i.test(msg)) return t('errWeakPassword')
  if (status === 429 || /rate limit|too many requests|for security purposes/i.test(msg)) return t('errRate')
  if (/invalid email|unable to validate email/i.test(msg)) return t('errEmail')
  return msg ? t('errGeneric', { msg }) : t('errUnknown')
}
