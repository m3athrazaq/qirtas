// Server and network errors in words the user can act on.
import { t } from '../lib/i18n'
import { ApiError } from './api'

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 0 || err.code === 'no_server' || err.status >= 500
  const msg = String((err as { message?: unknown })?.message ?? err ?? '')
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|err_name_not_resolved|err_internet/i.test(msg)
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'bad_code':
        return t('errLinkCode')
      case 'code_expired':
        return t('errLinkCodeExpired')
      case 'bad_key':
        return t('errRecoveryKey')
      case 'rate':
        return t('errRate')
      case 'bad_invite':
        return t('inviteInvalid')
      case 'forbidden':
      case 'not_member':
        return t('errForbidden')
      case 'unauthorized':
        return t('errUnlinked')
      case 'too_large':
        return t('errTooLarge')
    }
  }
  if (isNetworkError(err)) return t('errNetwork')
  const msg = String((err as { message?: unknown })?.message ?? err ?? '')
  return msg ? t('errGeneric', { msg }) : t('errUnknown')
}
