import { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import {
  startTriageSession,
  sendTriageMessage,
  getTriageSummary,
  bookTriageAppointment,
  type TriageDoctorSuggestion,
} from "../../lib/ai";

// PRD §3.5.1 Phase 2: the 8 supported triage languages.
// The mobile workspace intentionally does NOT depend on `@medcore/shared`
// (it's a separate RN / Expo bundle), so the constants below are a trimmed
// copy of packages/shared/src/i18n/triage-symptom-chips.ts. Any change to
// the canonical list must be reflected here. The backend Zod schema at
// packages/shared/src/validation/ai.ts is the source of truth for accepted
// codes — keep this tuple aligned with `TRIAGE_LANGUAGE_CODES` there.
type TriageLanguageCode =
  | "en"
  | "hi"
  | "ta"
  | "te"
  | "bn"
  | "mr"
  | "kn"
  | "ml";

const TRIAGE_LANGUAGE_CODES: TriageLanguageCode[] = [
  "en",
  "hi",
  "ta",
  "te",
  "bn",
  "mr",
  "kn",
  "ml",
];

const LANGUAGE_DISPLAY: Record<TriageLanguageCode, { englishName: string; nativeName: string }> = {
  en: { englishName: "English", nativeName: "English" },
  hi: { englishName: "Hindi", nativeName: "हिन्दी" },
  ta: { englishName: "Tamil", nativeName: "தமிழ்" },
  te: { englishName: "Telugu", nativeName: "తెలుగు" },
  bn: { englishName: "Bengali", nativeName: "বাংলা" },
  mr: { englishName: "Marathi", nativeName: "मराठी" },
  kn: { englishName: "Kannada", nativeName: "ಕನ್ನಡ" },
  ml: { englishName: "Malayalam", nativeName: "മലയാളം" },
};

interface SymptomChip {
  label: string;
  complaint: string;
}

// Medically verified translations; see shared package for the full docblock.
const SYMPTOM_CHIPS: Record<TriageLanguageCode, SymptomChip[]> = {
  en: [
    { label: "Fever", complaint: "Fever" },
    { label: "Cough", complaint: "Cough" },
    { label: "Chest pain", complaint: "Chest pain" },
    { label: "Headache", complaint: "Headache" },
    { label: "Abdominal pain", complaint: "Abdominal pain" },
    { label: "Breathlessness", complaint: "Breathlessness" },
    { label: "Vomiting", complaint: "Vomiting" },
    { label: "Diarrhoea", complaint: "Diarrhoea" },
    { label: "Back pain", complaint: "Back pain" },
    { label: "Fatigue", complaint: "Fatigue" },
  ],
  hi: [
    { label: "बुखार", complaint: "Fever" },
    { label: "खाँसी", complaint: "Cough" },
    { label: "सीने में दर्द", complaint: "Chest pain" },
    { label: "सिरदर्द", complaint: "Headache" },
    { label: "पेट दर्द", complaint: "Abdominal pain" },
    { label: "साँस लेने में तकलीफ", complaint: "Breathlessness" },
    { label: "उल्टी", complaint: "Vomiting" },
    { label: "दस्त", complaint: "Diarrhoea" },
    { label: "कमर दर्द", complaint: "Back pain" },
    { label: "थकान", complaint: "Fatigue" },
  ],
  ta: [
    { label: "காய்ச்சல்", complaint: "Fever" },
    { label: "இருமல்", complaint: "Cough" },
    { label: "மார்பு வலி", complaint: "Chest pain" },
    { label: "தலைவலி", complaint: "Headache" },
    { label: "வயிற்று வலி", complaint: "Abdominal pain" },
    { label: "மூச்சுத் திணறல்", complaint: "Breathlessness" },
    { label: "வாந்தி", complaint: "Vomiting" },
    { label: "வயிற்றுப்போக்கு", complaint: "Diarrhoea" },
    { label: "முதுகு வலி", complaint: "Back pain" },
    { label: "சோர்வு", complaint: "Fatigue" },
  ],
  te: [
    { label: "జ్వరం", complaint: "Fever" },
    { label: "దగ్గు", complaint: "Cough" },
    { label: "ఛాతీ నొప్పి", complaint: "Chest pain" },
    { label: "తలనొప్పి", complaint: "Headache" },
    { label: "పొట్ట నొప్పి", complaint: "Abdominal pain" },
    { label: "శ్వాస తీసుకోవడంలో ఇబ్బంది", complaint: "Breathlessness" },
    { label: "వాంతులు", complaint: "Vomiting" },
    { label: "విరేచనాలు", complaint: "Diarrhoea" },
    { label: "వెన్ను నొప్పి", complaint: "Back pain" },
    { label: "అలసట", complaint: "Fatigue" },
  ],
  bn: [
    { label: "জ্বর", complaint: "Fever" },
    { label: "কাশি", complaint: "Cough" },
    { label: "বুকে ব্যথা", complaint: "Chest pain" },
    { label: "মাথাব্যথা", complaint: "Headache" },
    { label: "পেটে ব্যথা", complaint: "Abdominal pain" },
    { label: "শ্বাসকষ্ট", complaint: "Breathlessness" },
    { label: "বমি", complaint: "Vomiting" },
    { label: "ডায়রিয়া", complaint: "Diarrhoea" },
    { label: "কোমর ব্যথা", complaint: "Back pain" },
    { label: "ক্লান্তি", complaint: "Fatigue" },
  ],
  mr: [
    { label: "ताप", complaint: "Fever" },
    { label: "खोकला", complaint: "Cough" },
    { label: "छातीत दुखणे", complaint: "Chest pain" },
    { label: "डोकेदुखी", complaint: "Headache" },
    { label: "पोटदुखी", complaint: "Abdominal pain" },
    { label: "श्वास घेण्यास त्रास", complaint: "Breathlessness" },
    { label: "उलटी", complaint: "Vomiting" },
    { label: "जुलाब", complaint: "Diarrhoea" },
    { label: "पाठदुखी", complaint: "Back pain" },
    { label: "थकवा", complaint: "Fatigue" },
  ],
  kn: [
    { label: "ಜ್ವರ", complaint: "Fever" },
    { label: "ಕೆಮ್ಮು", complaint: "Cough" },
    { label: "ಎದೆ ನೋವು", complaint: "Chest pain" },
    { label: "ತಲೆನೋವು", complaint: "Headache" },
    { label: "ಹೊಟ್ಟೆ ನೋವು", complaint: "Abdominal pain" },
    { label: "ಉಸಿರಾಟದ ತೊಂದರೆ", complaint: "Breathlessness" },
    { label: "ವಾಂತಿ", complaint: "Vomiting" },
    { label: "ಭೇದಿ", complaint: "Diarrhoea" },
    { label: "ಬೆನ್ನು ನೋವು", complaint: "Back pain" },
    { label: "ಆಯಾಸ", complaint: "Fatigue" },
  ],
  ml: [
    { label: "പനി", complaint: "Fever" },
    { label: "ചുമ", complaint: "Cough" },
    { label: "നെഞ്ചുവേദന", complaint: "Chest pain" },
    { label: "തലവേദന", complaint: "Headache" },
    { label: "വയറുവേദന", complaint: "Abdominal pain" },
    { label: "ശ്വാസതടസ്സം", complaint: "Breathlessness" },
    { label: "ഛർദ്ദി", complaint: "Vomiting" },
    { label: "വയറിളക്കം", complaint: "Diarrhoea" },
    { label: "പുറംവേദന", complaint: "Back pain" },
    { label: "ക്ഷീണം", complaint: "Fatigue" },
  ],
};

interface UIStrings {
  inputPlaceholder: string;
  symptomChipsLabel: string;
  languagePickerAria: string;
  languagePickerTitle: string;
  languagePickerSubtitle: string;
  startButton: string;
}

const UI_STRINGS: Record<TriageLanguageCode, UIStrings> = {
  en: {
    inputPlaceholder: "Describe your symptoms...",
    symptomChipsLabel: "Common symptoms",
    languagePickerAria: "Choose language",
    languagePickerTitle: "Choose your language",
    languagePickerSubtitle: "Select the language you're most comfortable in",
    startButton: "Start AI Triage",
  },
  hi: {
    inputPlaceholder: "अपनी तकलीफ बताएँ...",
    symptomChipsLabel: "सामान्य लक्षण",
    languagePickerAria: "भाषा चुनें",
    languagePickerTitle: "अपनी भाषा चुनें",
    languagePickerSubtitle: "आप जिस भाषा में सहज हैं उसे चुनें",
    startButton: "AI ट्रायज शुरू करें",
  },
  ta: {
    inputPlaceholder: "உங்கள் அறிகுறிகளை விவரிக்கவும்...",
    symptomChipsLabel: "பொதுவான அறிகுறிகள்",
    languagePickerAria: "மொழியைத் தேர்ந்தெடுக்கவும்",
    languagePickerTitle: "உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்",
    languagePickerSubtitle: "உங்களுக்கு வசதியான மொழியைத் தேர்ந்தெடுக்கவும்",
    startButton: "AI டிரையேஜ் தொடங்கவும்",
  },
  te: {
    inputPlaceholder: "మీ లక్షణాలను వివరించండి...",
    symptomChipsLabel: "సాధారణ లక్షణాలు",
    languagePickerAria: "భాషను ఎంచుకోండి",
    languagePickerTitle: "మీ భాషను ఎంచుకోండి",
    languagePickerSubtitle: "మీకు సౌకర్యంగా ఉన్న భాషను ఎంచుకోండి",
    startButton: "AI ట్రయేజ్ ప్రారంభించండి",
  },
  bn: {
    inputPlaceholder: "আপনার লক্ষণগুলি বর্ণনা করুন...",
    symptomChipsLabel: "সাধারণ লক্ষণ",
    languagePickerAria: "ভাষা নির্বাচন করুন",
    languagePickerTitle: "আপনার ভাষা নির্বাচন করুন",
    languagePickerSubtitle: "আপনি যে ভাষায় স্বাচ্ছন্দ্য বোধ করেন সেটি বেছে নিন",
    startButton: "AI ট্রায়েজ শুরু করুন",
  },
  mr: {
    inputPlaceholder: "तुमची लक्षणे सांगा...",
    symptomChipsLabel: "सामान्य लक्षणे",
    languagePickerAria: "भाषा निवडा",
    languagePickerTitle: "तुमची भाषा निवडा",
    languagePickerSubtitle: "तुम्हाला सोयीस्कर असलेली भाषा निवडा",
    startButton: "AI ट्रायज सुरू करा",
  },
  kn: {
    inputPlaceholder: "ನಿಮ್ಮ ಲಕ್ಷಣಗಳನ್ನು ವಿವರಿಸಿ...",
    symptomChipsLabel: "ಸಾಮಾನ್ಯ ಲಕ್ಷಣಗಳು",
    languagePickerAria: "ಭಾಷೆಯನ್ನು ಆರಿಸಿ",
    languagePickerTitle: "ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ",
    languagePickerSubtitle: "ನಿಮಗೆ ಅನುಕೂಲಕರವಾದ ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ",
    startButton: "AI ಟ್ರೈಯೇಜ್ ಪ್ರಾರಂಭಿಸಿ",
  },
  ml: {
    inputPlaceholder: "നിങ്ങളുടെ ലക്ഷണങ്ങൾ വിവരിക്കുക...",
    symptomChipsLabel: "സാധാരണ ലക്ഷണങ്ങൾ",
    languagePickerAria: "ഭാഷ തിരഞ്ഞെടുക്കുക",
    languagePickerTitle: "നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക",
    languagePickerSubtitle: "നിങ്ങൾക്ക് സൗകര്യപ്രദമായ ഭാഷ തിരഞ്ഞെടുക്കുക",
    startButton: "AI ട്രയാജ് ആരംഭിക്കുക",
  },
};

type ChatBubble = { role: "user" | "assistant"; content: string };

export default function AITriageChatScreen() {
  useAuth(); // keep auth hook mounted so SecureStore stays warm
  const router = useRouter();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [isEmergency, setIsEmergency] = useState(false);
  // PRD §3.5.1 Phase 2: we no longer auto-start on mount. The user picks a
  // language in the pre-chat selector and taps Start — identical to the web
  // flow so both surfaces share the same mental model.
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [doctorSuggestions, setDoctorSuggestions] = useState<TriageDoctorSuggestion[]>([]);
  const [booking, setBooking] = useState<string | null>(null);
  const [language, setLanguage] = useState<TriageLanguageCode>("en");
  const listRef = useRef<FlatList<ChatBubble>>(null);

  const uiStrings = UI_STRINGS[language] ?? UI_STRINGS.en;
  const symptomChips = SYMPTOM_CHIPS[language] ?? SYMPTOM_CHIPS.en;

  const startSession = useCallback(async () => {
    setStarting(true);
    try {
      // `startTriageSession` narrowly types `language` as "en" | "hi" today;
      // the runtime payload is forwarded verbatim and the backend Zod schema
      // now accepts all 8 Phase-2 codes, so the cast is safe.
      const res = await startTriageSession({
        language: language as "en" | "hi",
        inputMode: "text",
      });
      setSessionId(res.sessionId);
      setMessages([{ role: "assistant", content: res.message }]);
    } catch (err: any) {
      Alert.alert("Could not start chat", err?.message || "Please try again.");
    } finally {
      setStarting(false);
    }
  }, [language]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !sessionId || sending) return;

    // Optimistically append user bubble.
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    setSending(true);
    scrollToEnd();

    try {
      const resp = await sendTriageMessage(sessionId, text);
      setMessages((prev) => [...prev, { role: "assistant", content: resp.message }]);
      if (resp.isEmergency) {
        setIsEmergency(true);
      } else if (resp.sessionStatus === "AWAITING_BOOKING") {
        // Fetch doctor suggestions once triage decides on a specialty.
        try {
          const summary = await getTriageSummary(sessionId);
          setDoctorSuggestions(summary.doctorSuggestions ?? []);
        } catch {
          /* ignore — user can retry */
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't reach the server. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
      scrollToEnd();
    }
  };

  const handleBookDoctor = async (doc: TriageDoctorSuggestion) => {
    if (!sessionId) return;
    setBooking(doc.doctorId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await bookTriageAppointment(sessionId, {
        doctorId: doc.doctorId,
        date: today,
        slotStart: "09:00",
      });
      Alert.alert(
        "Appointment requested",
        `We have requested an appointment with ${doc.name}. You'll receive a confirmation shortly.`
      );
      router.replace("/(tabs)/appointments");
    } catch (err: any) {
      Alert.alert("Booking failed", err?.message || "Please try again.");
    } finally {
      setBooking(null);
    }
  };

  const renderBubble = ({ item }: { item: ChatBubble }) => {
    const isUser = item.role === "user";
    return (
      <View
        style={[
          styles.bubbleRow,
          isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant,
        ]}
      >
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAssistant,
          ]}
        >
          <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
            {item.content}
          </Text>
        </View>
      </View>
    );
  };

  if (starting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Starting AI Triage...</Text>
      </View>
    );
  }

  // PRD §3.5.1 Phase 2 — pre-chat language picker. Shown until the user
  // taps Start. The 8 options match the backend Zod enum in
  // packages/shared/src/validation/ai.ts.
  if (!sessionId) {
    return (
      <View style={styles.langPickerContainer}>
        <View style={styles.langPickerHeader}>
          <Ionicons name="medkit" size={22} color="#2563eb" />
          <Text style={styles.langPickerTitle}>{uiStrings.languagePickerTitle}</Text>
        </View>
        <Text style={styles.langPickerSubtitle}>{uiStrings.languagePickerSubtitle}</Text>
        <ScrollView
          contentContainerStyle={styles.langPickerList}
          accessibilityLabel={uiStrings.languagePickerAria}
        >
          {TRIAGE_LANGUAGE_CODES.map((code) => {
            const selected = code === language;
            return (
              <TouchableOpacity
                key={code}
                onPress={() => setLanguage(code)}
                style={[
                  styles.langPickerItem,
                  selected && styles.langPickerItemActive,
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.langPickerItemText,
                    selected && styles.langPickerItemTextActive,
                  ]}
                >
                  {LANGUAGE_DISPLAY[code].nativeName}
                </Text>
                <Text style={styles.langPickerItemSub}>
                  {LANGUAGE_DISPLAY[code].englishName}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity
          style={styles.langPickerStart}
          onPress={startSession}
          accessibilityLabel={uiStrings.startButton}
        >
          <Ionicons name="chatbubbles" size={18} color="#fff" />
          <Text style={styles.langPickerStartText}>{uiStrings.startButton}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="medkit" size={22} color="#fff" />
        <Text style={styles.headerTitle}>AI Triage</Text>
      </View>

      {/* Emergency banner */}
      {isEmergency && (
        <View style={styles.emergencyBanner}>
          <Ionicons name="warning" size={18} color="#fff" />
          <Text style={styles.emergencyText}>
            Possible emergency detected. Please call 108 or go to the nearest ER.
          </Text>
        </View>
      )}

      {/* Chat thread */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={renderBubble}
        contentContainerStyle={styles.threadContent}
        onContentSizeChange={scrollToEnd}
        ListFooterComponent={
          sending ? (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color="#9ca3af" />
              <Text style={styles.thinkingText}>Thinking...</Text>
            </View>
          ) : null
        }
      />

      {/* Doctor suggestions */}
      {doctorSuggestions.length > 0 && (
        <View style={styles.suggestionsWrap}>
          <Text style={styles.suggestionsTitle}>Suggested doctors</Text>
          {doctorSuggestions.slice(0, 3).map((doc) => (
            <View key={doc.doctorId} style={styles.doctorCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.doctorName}>{doc.name}</Text>
                <Text style={styles.doctorSpecialty}>{doc.specialty}</Text>
              </View>
              <TouchableOpacity
                style={styles.bookButton}
                disabled={booking === doc.doctorId}
                onPress={() => handleBookDoctor(doc)}
              >
                {booking === doc.doctorId ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.bookButtonText}>Book</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Symptom chips — PRD §3.5.1 Phase 2.
          Label is localised; clicking a chip drops the canonical English
          `complaint` into the draft so the LLM prompt stays consistent. */}
      {!isEmergency && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          accessibilityLabel={uiStrings.symptomChipsLabel}
        >
          {symptomChips.map((chip) => (
            <TouchableOpacity
              key={chip.complaint}
              style={styles.chip}
              onPress={() => setDraft(chip.complaint)}
              disabled={sending}
            >
              <Text style={styles.chipText}>{chip.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Composer */}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder={
            isEmergency
              ? "Chat paused — please seek immediate care"
              : uiStrings.inputPlaceholder
          }
          placeholderTextColor="#9ca3af"
          value={draft}
          onChangeText={setDraft}
          editable={!sending && !isEmergency}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!draft.trim() || sending || isEmergency) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!draft.trim() || sending || isEmergency}
          accessibilityLabel="Send message"
        >
          <Ionicons name="send" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#6b7280", fontSize: 14 },
  header: {
    backgroundColor: "#2563eb",
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "bold" },
  emergencyBanner: {
    backgroundColor: "#dc2626",
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  emergencyText: { color: "#fff", fontSize: 13, flex: 1, fontWeight: "600" },
  threadContent: { padding: 14, paddingBottom: 24 },
  bubbleRow: { flexDirection: "row", marginVertical: 4 },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowAssistant: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  bubbleUser: { backgroundColor: "#2563eb", borderBottomRightRadius: 4 },
  bubbleAssistant: {
    backgroundColor: "#fff",
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  bubbleTextUser: { color: "#fff", fontSize: 14, lineHeight: 20 },
  bubbleTextAssistant: { color: "#111827", fontSize: 14, lineHeight: 20 },
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  thinkingText: { color: "#9ca3af", fontSize: 12, fontStyle: "italic" },
  suggestionsWrap: {
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  suggestionsTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#6b7280",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  doctorCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    backgroundColor: "#f9fafb",
    borderRadius: 10,
    marginBottom: 6,
  },
  doctorName: { fontSize: 14, fontWeight: "600", color: "#111827" },
  doctorSpecialty: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  bookButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    minWidth: 64,
    alignItems: "center",
  },
  bookButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    gap: 8,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#f9fafb",
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: { backgroundColor: "#9ca3af" },
  // PRD §3.5.1 Phase 2 — language picker + symptom-chip styles.
  langPickerContainer: { flex: 1, backgroundColor: "#f3f4f6", padding: 20 },
  langPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  langPickerTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  langPickerSubtitle: { fontSize: 13, color: "#6b7280", marginBottom: 14 },
  langPickerList: { paddingBottom: 20 },
  langPickerItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 8,
  },
  langPickerItemActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  langPickerItemText: { fontSize: 16, fontWeight: "600", color: "#111827" },
  langPickerItemTextActive: { color: "#1d4ed8" },
  langPickerItemSub: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  langPickerStart: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 14,
  },
  langPickerStartText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  chipRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  chip: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 6,
  },
  chipText: { color: "#1d4ed8", fontSize: 12, fontWeight: "500" },
});
