export const supportedCustomerLocales = [
  { code: 'en', name: 'English' },
] as const

export type CustomerLocale = (typeof supportedCustomerLocales)[number]['code']

type CustomerMessageKey =
  | 'family.title'
  | 'family.description'
  | 'family.add'
  | 'family.edit'
  | 'family.remove'
  | 'family.revoke'
  | 'family.adultConsent'
  | 'family.guardianAuthorization'
  | 'settings.title'
  | 'settings.description'
  | 'settings.language'
  | 'settings.languageStatus'
  | 'settings.theme'
  | 'settings.textSize'
  | 'settings.orderNotifications'
  | 'settings.medicineNotifications'

const customerMessages: Record<CustomerLocale, Record<CustomerMessageKey, string>> = {
  en: {
    'family.title': 'Family profiles',
    'family.description': 'Optional profiles for people you are authorized to support. No prescriptions or medical records are shared.',
    'family.add': 'Add family member',
    'family.edit': 'Edit',
    'family.remove': 'Remove profile',
    'family.revoke': 'Revoke authorization',
    'family.adultConsent': 'I confirm this adult has explicitly consented to this profile being managed from my account.',
    'family.guardianAuthorization': 'I confirm I am the legal guardian or otherwise authorized to manage this minor’s profile.',
    'settings.title': 'Customer preferences',
    'settings.description': 'Preferences are saved to your account. Medicine names and medical instructions are never translated.',
    'settings.language': 'Language',
    'settings.languageStatus': 'English is available now. Other languages will appear only after complete translation and verification.',
    'settings.theme': 'Theme',
    'settings.textSize': 'Text size',
    'settings.orderNotifications': 'Order update notifications',
    'settings.medicineNotifications': 'Opt-in medicine alert notifications',
  },
}

export function customerText(locale: CustomerLocale, key: CustomerMessageKey): string {
  return customerMessages[locale][key]
}
