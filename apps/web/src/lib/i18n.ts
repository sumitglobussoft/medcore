"use client";

import { create } from "zustand";

export type Lang = "en" | "hi";

const STORAGE_KEY = "medcore_lang";

type Dict = Record<string, string>;

const en: Dict = {
  // Brand
  "app.name": "MedCore",
  "app.tagline": "Hospital Operations Automation",

  // Login
  "login.title": "Sign In",
  "login.email": "Email",
  "login.email.placeholder": "Enter your email",
  "login.password": "Password",
  "login.password.placeholder": "Enter your password",
  "login.submit": "Sign In",
  "login.submit.loading": "Signing in...",
  "login.forgot": "Forgot Password?",
  "login.newPatient": "New Patient?",
  "login.register": "Register here",
  "login.error.generic": "Login failed",

  // Register
  "register.title": "Patient Registration",
  "register.fullName": "Full Name",
  "register.fullName.placeholder": "Enter your full name",
  "register.email": "Email",
  "register.phone": "Phone",
  "register.phone.placeholder": "Phone number",
  "register.password": "Password",
  "register.password.placeholder": "Create a password (min 6 characters)",
  "register.gender": "Gender",
  "register.gender.male": "Male",
  "register.gender.female": "Female",
  "register.gender.other": "Other",
  "register.age": "Age",
  "register.age.placeholder": "Your age",
  "register.address": "Address",
  "register.address.placeholder": "Your address (optional)",
  "register.submit": "Register",
  "register.submit.loading": "Registering...",
  "register.haveAccount": "Already have an account?",
  "register.signIn": "Sign in here",
  "register.error.generic": "Registration failed",

  // Feedback
  "feedback.title": "How was your visit?",
  "feedback.subtitle":
    "Please rate your experience. Your feedback helps us serve you better.",
  "feedback.cat.doctor": "Doctor",
  "feedback.cat.nurse": "Nurse",
  "feedback.cat.food": "Food",
  "feedback.cat.cleanliness": "Cleanliness",
  "feedback.cat.overall": "Overall Experience",
  "feedback.nps": "How likely are you to recommend us?",
  "feedback.nps.low": "Not likely",
  "feedback.nps.high": "Very likely",
  "feedback.comments": "Additional comments (optional)",
  "feedback.comments.placeholder":
    "Share anything else you'd like us to know...",
  "feedback.submit": "Submit Feedback",
  "feedback.submit.loading": "Submitting...",
  "feedback.thankYou": "Thank You!",
  "feedback.thankYou.body":
    "Your feedback has been submitted. We appreciate you helping us improve our service.",
  "feedback.error": "We couldn't record your feedback. Please contact the hospital.",

  // Common
  "common.cancel": "Cancel",
  "common.submit": "Submit",
  "common.save": "Save",
  "common.close": "Close",
  "common.loading": "Loading...",
  "common.language": "Language",
  "common.english": "English",
  "common.hindi": "हिन्दी",
};

const hi: Dict = {
  // Brand
  "app.name": "मेडकोर",
  "app.tagline": "अस्पताल संचालन स्वचालन",

  // Login
  "login.title": "साइन इन करें",
  "login.email": "ईमेल",
  "login.email.placeholder": "अपना ईमेल दर्ज करें",
  "login.password": "पासवर्ड",
  "login.password.placeholder": "अपना पासवर्ड दर्ज करें",
  "login.submit": "साइन इन",
  "login.submit.loading": "साइन इन हो रहा है...",
  "login.forgot": "पासवर्ड भूल गए?",
  "login.newPatient": "नए मरीज़?",
  "login.register": "यहाँ पंजीकरण करें",
  "login.error.generic": "लॉगिन विफल",

  // Register
  "register.title": "मरीज़ पंजीकरण",
  "register.fullName": "पूरा नाम",
  "register.fullName.placeholder": "अपना पूरा नाम दर्ज करें",
  "register.email": "ईमेल",
  "register.phone": "फ़ोन",
  "register.phone.placeholder": "फ़ोन नंबर",
  "register.password": "पासवर्ड",
  "register.password.placeholder": "पासवर्ड बनाएं (कम से कम 6 अक्षर)",
  "register.gender": "लिंग",
  "register.gender.male": "पुरुष",
  "register.gender.female": "महिला",
  "register.gender.other": "अन्य",
  "register.age": "आयु",
  "register.age.placeholder": "आपकी आयु",
  "register.address": "पता",
  "register.address.placeholder": "आपका पता (वैकल्पिक)",
  "register.submit": "पंजीकरण करें",
  "register.submit.loading": "पंजीकरण हो रहा है...",
  "register.haveAccount": "पहले से खाता है?",
  "register.signIn": "यहाँ साइन इन करें",
  "register.error.generic": "पंजीकरण विफल",

  // Feedback
  "feedback.title": "आपकी यात्रा कैसी रही?",
  "feedback.subtitle":
    "कृपया अपने अनुभव को रेट करें। आपकी प्रतिक्रिया हमें आपकी बेहतर सेवा करने में मदद करती है।",
  "feedback.cat.doctor": "डॉक्टर",
  "feedback.cat.nurse": "नर्स",
  "feedback.cat.food": "भोजन",
  "feedback.cat.cleanliness": "स्वच्छता",
  "feedback.cat.overall": "समग्र अनुभव",
  "feedback.nps": "आप हमें दूसरों को कितनी संभावना से सुझाएंगे?",
  "feedback.nps.low": "संभावना नहीं",
  "feedback.nps.high": "बहुत संभावना",
  "feedback.comments": "अतिरिक्त टिप्पणियाँ (वैकल्पिक)",
  "feedback.comments.placeholder":
    "और कुछ जो आप हमें बताना चाहेंगे...",
  "feedback.submit": "प्रतिक्रिया भेजें",
  "feedback.submit.loading": "भेजा जा रहा है...",
  "feedback.thankYou": "धन्यवाद!",
  "feedback.thankYou.body":
    "आपकी प्रतिक्रिया प्राप्त हो गई है। हमारी सेवा को बेहतर बनाने में आपकी मदद के लिए धन्यवाद।",
  "feedback.error":
    "हम आपकी प्रतिक्रिया दर्ज नहीं कर सके। कृपया अस्पताल से संपर्क करें।",

  // Common
  "common.cancel": "रद्द करें",
  "common.submit": "भेजें",
  "common.save": "सहेजें",
  "common.close": "बंद करें",
  "common.loading": "लोड हो रहा है...",
  "common.language": "भाषा",
  "common.english": "English",
  "common.hindi": "हिन्दी",
};

const translations: Record<Lang, Dict> = { en, hi };

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
  init: () => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: "en",
  setLang: (l) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, l);
    }
    set({ lang: l });
  },
  init: () => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored === "en" || stored === "hi") {
      set({ lang: stored });
    }
  },
}));

export function useTranslation() {
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const dict = translations[lang] || translations.en;

  function t(key: string, fallback?: string): string {
    return dict[key] ?? fallback ?? key;
  }

  return { t, lang, setLang };
}

// Actual LanguageDropdown JSX component lives in components/LanguageDropdown.tsx
