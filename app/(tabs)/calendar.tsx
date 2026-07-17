import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, TextInput, Alert, Linking, Platform, Image,
  Dimensions, RefreshControl, Pressable, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '@/components/ui/GlassCard';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors } from '@/lib/theme';
import { BlurView } from 'expo-blur';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useUser } from '@/contexts/UserContext';
import { canCreateEvents } from '@/lib/roles';
import {
  fetchSessionsOrdered,
  formatSessionLongDate,
  formatSessionTimeRange,
  createSession,
  getMyRsvp,
  setMyRsvp,
  getRsvpCoverage,
  buildSessionsIcs,
  type SessionListItem,
  type RsvpCoverage,
} from '@/lib/sessions';

type ViewMode = 'month' | 'week' | 'day';

// ─── Picker Data (static, top-level) ─────────────────────────────────────────
const TIME_SLOTS: string[] = (() => {
  const s: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 5) {
    const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 === 0 ? 12 : h % 12;
    s.push(`${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ap}`);
  }
  return s;
})();

const DUR_SLOTS = [
  '15 min','30 min','45 min',
  '1 hr','1h 15m','1h 30m','1h 45m',
  '2 hr','2h 30m','3 hr','3h 30m',
  '4 hr','4h 30m','5 hr','5h 30m',
  '6 hr','6h 30m','7 hr','7h 30m',
  '8 hr','8h 30m','9 hr','9h 30m',
  '10 hr',
];

const MONTHS = Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
const DAYS   = Array.from({length:31},(_,i)=>String(i+1).padStart(2,'0'));
const YEARS  = Array.from({length:25},(_,i)=>String(2026+i));

function durSlotToMins(s: string): number {
  if (s.includes('min')) return parseInt(s, 10);
  if (s.includes('hr') && !s.includes('m')) return parseInt(s, 10) * 60;
  const [hPart, rest] = s.split('h');
  return parseInt(hPart, 10) * 60 + (rest ? parseInt(rest, 10) : 0);
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TAG_STYLE: Record<string, { bg: string; text: string }> = {
  UPCOMING: { bg:'rgba(44,124,150,0.15)', text:'#2C7C96' },
  OPTIONAL: { bg:'rgba(94,116,136,0.15)', text:'#7A7A7A' },
  NEW:      { bg:'rgba(76,122,97,0.15)', text:'#2C7C96' },
};
const MONTH_NAMES   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTH   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAY_FULL  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const WEEKDAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const SCREEN_W      = Dimensions.get('window').width;
const ITEM_WIDTH    = Math.floor(SCREEN_W / 7);
const CENTER_PAD    = SCREEN_W / 2 - ITEM_WIDTH / 2;
const WEEK_PAD      = (SCREEN_W - (ITEM_WIDTH * 7)) / 2;
const DATE_ROW_H    = 36;
const TIME_ROW_H    = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toYMD(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function getDayLetter(d: Date) { return 'SMTWTFS'[d.getDay()]; }
function sessionDisplay(isoDate: string) { const d = new Date(isoDate+'T12:00:00'); return { day: WEEKDAY_SHORT[d.getDay()], date: d.getDate() }; }
function openAppleMaps(loc: string) {
  const url = Platform.OS==='ios'?`maps://?daddr=${encodeURIComponent(loc)}`:`https://maps.google.com/?daddr=${encodeURIComponent(loc)}`;
  Linking.canOpenURL(url).then(ok => ok ? Linking.openURL(url) : Alert.alert('Maps unavailable'));
}

// ─── WheelPicker — ScrollView-based (safe inside outer ScrollView) ────────────
function WheelPicker({
  data, selected, onSelect, rowH, pickerH, isAuto = false,
}: {
  data: string[]; selected: string; onSelect: (v: string) => void;
  rowH: number; pickerH: number; isAuto?: boolean;
}) {
  const ref = useRef<ScrollView>(null);
  const isUserDrag = useRef(false);

  // Infinite looping logic
  // Disable infinite looping for the 'Years' wheel (data length 25)
  const isYear = data.length === 25;
  // Use much smaller repeat multiples to prevent massive DOM bloat (which causes the Modal pop-up lag)
  const REPEATS = isYear ? 1 : (data.length > 50 ? 5 : 21);
  const midRepeat = Math.floor(REPEATS / 2);

  const loopedData = useMemo(() => {
    const arr = [];
    for (let i = 0; i < REPEATS; i++) arr.push(...data);
    return arr;
  }, [data, REPEATS]);

  const padded = useMemo(() => ['', ...loopedData, ''], [loopedData]);

  // Jump to the middle block on initial mount
  useEffect(() => {
    const idx = Math.max(0, data.indexOf(selected));
    const startIdx = midRepeat * data.length + idx;
    const t = setTimeout(() => ref.current?.scrollTo({ y: startIdx * rowH, animated: false }), 80);
    return () => clearTimeout(t);
  }, []); // Run once!

  // When auto-computed, animate to correct position dynamically
  useEffect(() => {
    if (isAuto) {
      const idx = data.indexOf(selected);
      if (idx >= 0) {
        const targetIdx = midRepeat * data.length + idx;
        const t = setTimeout(() => ref.current?.scrollTo({ y: targetIdx * rowH, animated: true }), 120);
        return () => clearTimeout(t);
      }
    }
  }, [isAuto, selected, data, midRepeat, rowH]);

  return (
    <View style={[styles.wheelWrap, { height: pickerH }, isAuto && styles.wheelDisabled]}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={rowH}
        decelerationRate="fast"
        scrollEnabled={true} // Always allow scrolling to take control
        scrollEventThrottle={16}
        onScrollBeginDrag={() => { isUserDrag.current = true; }}
        onMomentumScrollEnd={(e) => {
          if (!isUserDrag.current) return;
          isUserDrag.current = false;
          let i = Math.round(e.nativeEvent.contentOffset.y / rowH);
          if (i < 0) i = 0;
          if (i >= loopedData.length) i = loopedData.length - 1;
          
          if (loopedData[i] !== undefined) onSelect(loopedData[i]);

          // Infinite loop: If we scroll near the edge, silently snap back to the middle block
          if (i < data.length || i > loopedData.length - data.length * 2) {
            const resetI = midRepeat * data.length + (i % data.length);
            setTimeout(() => ref.current?.scrollTo({ y: resetI * rowH, animated: false }), 50);
          }
        }}
        onScrollEndDrag={(e) => {
          // Immediately update selection on finger release
          if (!isUserDrag.current) return;
          let i = Math.round(e.nativeEvent.contentOffset.y / rowH);
          if (i < 0) i = 0;
          if (i >= loopedData.length) i = loopedData.length - 1;
          if (loopedData[i] !== undefined) onSelect(loopedData[i]);
        }}
      >
        {padded.map((item, i) => (
          <View key={i} style={{ height: rowH, alignItems: 'center', justifyContent: 'center' }}>
            <Text
              numberOfLines={1}
              style={[styles.wheelTxt, item === selected ? styles.wheelActive : styles.wheelInactive]}
            >
              {item}
            </Text>
          </View>
        ))}
      </ScrollView>
      {/* Center-row highlight rail */}
      <View style={[styles.wheelRail, { top: pickerH/2 - rowH/2, height: rowH }]} pointerEvents="none" />
      {/* Fade top/bottom for depth */}
      <View style={[styles.wheelFade, styles.wheelFadeTop]}    pointerEvents="none" />
      <View style={[styles.wheelFade, styles.wheelFadeBottom]} pointerEvents="none" />
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CalendarScreen() {
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();
  const { user, profile, org } = useUser();
  const canCreate = canCreateEvents(profile?.role);
  const { add, rsvp } = useLocalSearchParams<{ add?: string; rsvp?: string }>();

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const todayYMD  = useMemo(() => toYMD(today), [today]);

  const rangeStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 63); // 9 weeks back
    d.setDate(d.getDate() - d.getDay()); // Go to previous Sunday
    return d;
  }, [today]);

  const dateRange = useMemo(() => Array.from({length:126},(_,i) => addDays(rangeStart, i)), [rangeStart]);
  const todayIndex = useMemo(() => Math.round((today.getTime() - rangeStart.getTime()) / (1000*60*60*24)), [today, rangeStart]);

  const [selectedDate, setSelectedDate] = useState(today);
  const selectedYMD = useMemo(() => toYMD(selectedDate), [selectedDate]);
  const [viewMode, setViewMode]         = useState<ViewMode>('week');
  const [detail, setDetail]             = useState<SessionListItem | null>(null);
  const [detailRsvp, setDetailRsvp]     = useState<'none' | 'going' | 'not_going'>('none');
  const [coverage, setCoverage]         = useState<RsvpCoverage | null>(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [sessions, setSessions]       = useState<SessionListItem[]>([]);
  const [sessionsRefreshing, setSessionsRefreshing] = useState(false);
  const [creating, setCreating]       = useState(false);

  const loadSessions = useCallback(async () => {
    setSessions(await fetchSessionsOrdered());
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const onSessionsRefresh = useCallback(async () => {
    setSessionsRefreshing(true);
    await loadSessions();
    setSessionsRefreshing(false);
  }, [loadSessions]);

  // Month Grid Calculation
  const monthGridDays = useMemo(() => {
    const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const startDayOfWeek = firstDay.getDay();
    const gridStart = new Date(firstDay);
    gridStart.setDate(gridStart.getDate() - startDayOfWeek);
    return Array.from({length: 42}, (_, i) => addDays(gridStart, i));
  }, [selectedDate]);

  // Enforce week view when mounting (if requested)
  useFocusEffect(
    useCallback(() => {
      // Intentionally leaving this out so we don't clobber the user's view if they just switch tabs,
      // but they requested "leaving the menu will return automatically to the week view".
      setViewMode('week');
    }, [])
  );

  // ── Form state ────────────────────────────────────────────────────────────
  const [title,    setTitle]    = useState('');
  const [location, setLocation] = useState('');
  // Repeats: 1 = "None" (single event), 2-12 = weekly for N weeks.
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  const [exportingIcs, setExportingIcs] = useState(false);

  // Global toggle: 'wheels' | 'type'
  const [inputMode, setInputMode] = useState<'wheels'|'type'>('wheels');

  // Date wheels
  const [selMonth, setSelMonth] = useState('03');
  const [selDay,   setSelDay]   = useState('23');
  const [selYear,  setSelYear]  = useState('2026');
  const [manualDate, setManualDate] = useState('03/23/2026');
  useEffect(() => {
    if (inputMode === 'wheels') setManualDate(`${selMonth}/${selDay}/${selYear}`);
  }, [selMonth, selDay, selYear, inputMode]);

  // Time wheels — three independent fields
  const [selStart, setSelStart] = useState('10:00 AM');
  const [selDur,   setSelDur]   = useState('2 hr');
  const [selEnd,   setSelEnd]   = useState('12:00 PM');
  // Type mode text
  const [manualStart, setManualStart] = useState('10:00 AM');
  const [manualDur,   setManualDur]   = useState('2 hr');

  // Track last-two touched fields; the un-touched one is auto
  type TF = 'start' | 'duration' | 'end';
  const ALL_TF: TF[] = ['start', 'duration', 'end'];
  const [touched, setTouched] = useState<[TF, TF]>(['start', 'duration']); // default: end is auto
  const autoField: TF = ALL_TF.find(f => !touched.includes(f))!;

  const handleTimeChange = useCallback((field: TF, value: string) => {
    if (field === 'start')    setSelStart(value);
    else if (field === 'duration') setSelDur(value);
    else if (field === 'end')      setSelEnd(value);
    
    setTouched(prev => {
      // If it's already the most recently touched, no change to queue
      if (prev[1] === field) return prev;
      // If it's the older touched field, move it to the front (most recent)
      if (prev[0] === field) return [prev[1], prev[0]];
      // If it's the current 'Auto' field being manually touched, drop the oldest touched
      return [prev[1], field];
    });
  }, []);

  // Compute the auto field value
  const computedTimeValue = useMemo<string>(() => {
    if (autoField === 'end') {
      const si = TIME_SLOTS.indexOf(selStart);
      const steps = Math.ceil(durSlotToMins(selDur) / 5);
      return TIME_SLOTS[(si + steps) % TIME_SLOTS.length] ?? '12:00 PM';
    }
    if (autoField === 'start') {
      const ei = TIME_SLOTS.indexOf(selEnd);
      const steps = Math.ceil(durSlotToMins(selDur) / 5);
      return TIME_SLOTS[((ei - steps) % TIME_SLOTS.length + TIME_SLOTS.length) % TIME_SLOTS.length];
    }
    // autoField === 'duration': find closest DUR_SLOT
    const si = TIME_SLOTS.indexOf(selStart), ei = TIME_SLOTS.indexOf(selEnd);
    const diff = ((ei - si) + TIME_SLOTS.length) % TIME_SLOTS.length * 5;
    return DUR_SLOTS.reduce((best, s) => Math.abs(durSlotToMins(s)-diff) < Math.abs(durSlotToMins(best)-diff) ? s : best);
  }, [autoField, selStart, selDur, selEnd]);

  // Effective values (auto replaces one field)
  const effStart = autoField === 'start'    ? computedTimeValue : selStart;
  const effDur   = autoField === 'duration' ? computedTimeValue : selDur;
  const effEnd   = autoField === 'end'      ? computedTimeValue : selEnd;

  const manualEndDisplay = useMemo(() => `${manualStart} + ${manualDur}`, [manualStart, manualDur]);

  useFocusEffect(useCallback(() => {
    setViewMode('week');
    // Center on today: show ~2 past days and ~4 future days
    const t = setTimeout(() => scrollRef.current?.scrollTo({ x: Math.max(0, todayIndex - 2) * ITEM_WIDTH, animated: false }), 100);
    return () => clearTimeout(t);
  }, [todayIndex]));

  const filteredSessions = useMemo(() => {
    if (viewMode === 'day') return sessions.filter(s => s.isoDate === selectedYMD);
    if (viewMode === 'month') return sessions.filter(s => s.isoDate.startsWith(selectedYMD.substring(0, 7)));
    const sw = new Date(selectedDate); sw.setDate(sw.getDate()-sw.getDay());
    const s = toYMD(sw), e = toYMD(addDays(sw, 6));
    return sessions.filter(s2 => s2.isoDate >= s && s2.isoDate <= e);
  }, [viewMode, selectedYMD, selectedDate, sessions]);

  const subtitle = useMemo(() => {
    if (viewMode === 'month') return `${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;
    if (viewMode === 'day') return `${WEEKDAY_FULL[selectedDate.getDay()]}, ${MONTH_NAMES[selectedDate.getMonth()]} ${selectedDate.getDate()}`;
    const sw = new Date(selectedDate); sw.setDate(sw.getDate()-sw.getDay());
    const ew = new Date(sw); ew.setDate(ew.getDate()+6);
    if (sw.getMonth() === ew.getMonth()) {
      return `Week of ${MONTH_NAMES[sw.getMonth()]} ${sw.getDate()}-${ew.getDate()}`;
    }
    return `Week of ${MONTH_NAMES[sw.getMonth()]} ${sw.getDate()} - ${MONTH_NAMES[ew.getMonth()]} ${ew.getDate()}`;
  }, [viewMode, selectedDate]);

  const resetToToday = () => {
    setSelectedDate(today);
    setViewMode('week');
    setTimeout(() => scrollRef.current?.scrollTo({ x: Math.max(0, todayIndex - 2) * ITEM_WIDTH, animated: true }), 50);
  };

  const goToPrevMonth = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const goToNextMonth = () => setSelectedDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  // Direct week/month switch — one tap, no cycling through a hidden 'day' state.
  const setView = (m: 'week' | 'month') => {
    if (m === 'month') { setViewMode('month'); return; }
    setViewMode('week');
    const idx = dateRange.findIndex(d => toYMD(d) === selectedYMD);
    const base = idx >= 0 ? idx : todayIndex;
    setTimeout(() => scrollRef.current?.scrollTo({ x: Math.max(0, base - 2) * ITEM_WIDTH, animated: true }), 50);
  };

  const handleOpenAddEvent = () => {
    // Snap to the real current world date/time
    const now = new Date();
    setSelYear(String(now.getFullYear()));
    setSelMonth(String(now.getMonth() + 1).padStart(2,'0'));
    setSelDay(String(now.getDate()).padStart(2,'0'));
    
    // Round current time UP to the nearest 5 minutes
    now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5);
    
    let h = now.getHours();
    const m = now.getMinutes();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const startStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ap}`;
    
    setSelStart(TIME_SLOTS.includes(startStr) ? startStr : '10:00 AM');
    setSelDur('1 hr');
    setTouched(['duration', 'start']); // Makes 'End' the auto-computed field
    setRepeatWeeks(1);

    setShowAddEvent(true);
  };

  // Open the New Event sheet when arriving via the quick-action FAB (?add=1).
  useEffect(() => {
    if (add === '1' && canCreate) {
      handleOpenAddEvent();
      router.setParams({ add: undefined });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, canCreate]);

  // FAB "RSVP to Session" (?rsvp=1): open the next upcoming session's detail
  // sheet, which carries the RSVP buttons.
  useEffect(() => {
    if (rsvp !== '1' || sessions.length === 0) return;
    router.setParams({ rsvp: undefined });
    const now = Date.now();
    const next = sessions.find((s) => s.endMs >= now) ?? null;
    if (next) setDetail(next);
    else Alert.alert('Nothing scheduled', 'There are no upcoming sessions to RSVP to yet.');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rsvp, sessions]);

  // Load the signed-in user's RSVP whenever a session detail opens.
  useEffect(() => {
    (async () => {
      if (detail && user) setDetailRsvp(await getMyRsvp(detail.id, user.id));
      else setDetailRsvp('none');
    })();
  }, [detail?.id, user?.id]);

  // Coordinators see live staffing coverage for the session.
  useEffect(() => {
    (async () => {
      if (detail && canCreate) setCoverage(await getRsvpCoverage(detail.id, profile?.organization_id ?? null));
      else setCoverage(null);
    })();
  }, [detail?.id, canCreate, profile?.organization_id]);

  const persistDetailRsvp = async (status: 'going' | 'not_going') => {
    if (!detail || !user) return;
    setDetailRsvp(status);
    const { error } = await setMyRsvp(detail.id, user.id, status);
    if (error) console.warn('[rsvp] save failed:', error.message);
  };

  const parseTime12 = (s: string): { h: number; min: number } | null => {
    const m = s.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[1], 10) % 12;
    if (/PM/i.test(m[3])) h += 12;
    return { h, min: parseInt(m[2], 10) };
  };

  const handleCreateEvent = async () => {
    if (!title.trim()) { Alert.alert('Required', 'Enter an event title.'); return; }
    if (!profile?.organization_id) { Alert.alert('No organization', 'Join an organization before creating events.'); return; }
    let yyyy: number, mm: number, dd: number;
    if (inputMode === 'type') {
      const dm = manualDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!dm) { Alert.alert('Invalid date', 'Use MM/DD/YYYY.'); return; }
      mm = +dm[1]; dd = +dm[2]; yyyy = +dm[3];
    } else {
      mm = +selMonth; dd = +selDay; yyyy = +selYear;
    }
    const st = parseTime12(effStart);
    const et = parseTime12(effEnd);
    if (!st || !et) { Alert.alert('Invalid time', 'Check the start/end time.'); return; }
    const start = new Date(yyyy, mm - 1, dd, st.h, st.min);
    // Reject impossible dates (e.g. 13/45 or 02/31 rolling over).
    if (start.getFullYear() !== yyyy || start.getMonth() !== mm - 1 || start.getDate() !== dd) {
      Alert.alert('Invalid date', 'That date doesn’t exist — check month/day.'); return;
    }
    const end = new Date(yyyy, mm - 1, dd, et.h, et.min);
    if (end <= start) {
      Alert.alert('Check the times', 'End time must be after the start time.'); return;
    }

    setCreating(true);
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const occurrences = Math.max(1, Math.min(12, repeatWeeks));
    for (let i = 0; i < occurrences; i++) {
      const occStart = new Date(start.getTime() + i * WEEK_MS);
      const occEnd = new Date(end.getTime() + i * WEEK_MS);
      const { error } = await createSession({
        title: title.trim(),
        location: location.trim() || null,
        startISO: occStart.toISOString(),
        endISO: occEnd.toISOString(),
        organizationId: profile?.organization_id ?? null,
        createdBy: profile?.id ?? null,
      });
      if (error) {
        setCreating(false);
        Alert.alert('Could not create event', i > 0 ? `${i} of ${occurrences} occurrences were created before this error: ${error.message}` : error.message);
        await loadSessions();
        return;
      }
    }
    setCreating(false);
    setShowAddEvent(false);
    setTitle(''); setLocation(''); setRepeatWeeks(1);
    await loadSessions();
  };

  // ── Calendar export (.ics) — share via the OS share sheet ──────────────────
  const shareIcs = async (ics: string, filename: string) => {
    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(ics);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { UTI: 'com.apple.ical.ics', mimeType: 'text/calendar' });
    } else {
      Alert.alert('Saved', 'The calendar file was generated but sharing is unavailable on this device.');
    }
  };

  const exportSessionToCalendar = async (session: SessionListItem) => {
    setExportingIcs(true);
    try {
      const ics = buildSessionsIcs(
        [{
          id: session.id, title: session.title, description: session.description ?? null,
          location: session.location, start_time: session.start_time, end_time: session.end_time,
        }],
        org?.name || 'Alloy Mentors'
      );
      await shareIcs(ics, `${session.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'session'}.ics`);
    } catch (e: any) {
      Alert.alert("Couldn't export", e?.message ?? 'Try again.');
    } finally {
      setExportingIcs(false);
    }
  };

  const exportAllUpcomingToCalendar = async () => {
    const now = Date.now();
    const upcoming = sessions.filter((s) => s.endMs >= now);
    if (upcoming.length === 0) { Alert.alert('Nothing to export', 'There are no upcoming sessions yet.'); return; }
    setExportingIcs(true);
    try {
      const ics = buildSessionsIcs(
        upcoming.map((s) => ({
          id: s.id, title: s.title, description: s.description ?? null,
          location: s.location, start_time: s.start_time, end_time: s.end_time,
        })),
        org?.name || 'Alloy Mentors'
      );
      await shareIcs(ics, `${(org?.name || 'alloy-mentors').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-schedule.ics`);
    } catch (e: any) {
      Alert.alert("Couldn't export", e?.message ?? 'Try again.');
    } finally {
      setExportingIcs(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <AuroraBackground />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={sessionsRefreshing}
            onRefresh={onSessionsRefresh}
            tintColor="#22271F"
          />
        }
      >

        {/* Header — title on its own line, controls beneath (editorial masthead) */}
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Schedule</Text>
          <Text style={styles.pageSubtitle} numberOfLines={1}>{subtitle}</Text>
          <View style={styles.headerControls}>
            {/* Today */}
            <TouchableOpacity onPress={resetToToday} style={styles.todayBtn} activeOpacity={0.8}>
              <Ionicons name="today-outline" size={15} color={colors.platinum} />
              <Text style={styles.todayBtnTxt}>Today</Text>
            </TouchableOpacity>

            {/* Week / Month segmented toggle */}
            <View style={styles.segment}>
              {(['week', 'month'] as const).map((m) => {
                const active = (viewMode === 'month' ? 'month' : 'week') === m;
                return (
                  <TouchableOpacity
                    key={m}
                    onPress={() => setView(m)}
                    style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.segmentTxt, active && styles.segmentTxtActive]}>
                      {m === 'week' ? 'Week' : 'Month'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ flex: 1 }} />

            <TouchableOpacity onPress={exportAllUpcomingToCalendar} style={styles.addBtn} activeOpacity={0.8} disabled={exportingIcs}>
              {exportingIcs ? <ActivityIndicator size="small" color={colors.platinum} /> : <Ionicons name="calendar-outline" size={18} color={colors.platinum} />}
            </TouchableOpacity>

            {canCreate && (
              <TouchableOpacity onPress={handleOpenAddEvent} style={styles.addBtn} activeOpacity={0.8}>
                <Ionicons name="add" size={22} color={colors.platinum} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Context Strip or Month Grid */}
        {viewMode === 'month' ? (
          <GlassCard style={{ marginBottom: 24, borderRadius: 24 }} contentStyle={{ padding: 20 }}>
            {/* Month navigation */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <TouchableOpacity onPress={goToPrevMonth} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(196,196,196,0.08)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', alignItems: 'center', justifyContent: 'center' }} activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={18} color="rgba(34,39,31,0.75)" />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'Inter-Bold', fontSize: 17, color: '#22271F', letterSpacing: -0.3 }}>
                {MONTH_NAMES[selectedDate.getMonth()]} {selectedDate.getFullYear()}
              </Text>
              <TouchableOpacity onPress={goToNextMonth} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(196,196,196,0.08)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', alignItems: 'center', justifyContent: 'center' }} activeOpacity={0.7}>
                <Ionicons name="chevron-forward" size={18} color="rgba(34,39,31,0.75)" />
              </TouchableOpacity>
            </View>
            {/* Weekday headers */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 }}>
              {WEEKDAY_SHORT.map((wd, i) => (
                <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: 'Inter-SemiBold', fontSize: 11, color: 'rgba(34,39,31,0.3)', textTransform: 'uppercase' }}>{wd}</Text>
              ))}
            </View>
            {/* Grid */}
            <View style={{ gap: 10 }}>
              {Array.from({length: 6}).map((_, rowIndex) => {
                const rowDays = monthGridDays.slice(rowIndex * 7, rowIndex * 7 + 7);
                // Hide row if the entire row is completely outside the month (happens sometimes on 6th row)
                if (rowIndex === 5 && rowDays[0].getMonth() !== selectedDate.getMonth()) return null;
                
                return (
                  <View key={rowIndex} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    {rowDays.map((d, colIndex) => {
                      const dayYMD = toYMD(d);
                      const isTdy = dayYMD === todayYMD;
                      const isCurMonth = d.getMonth() === selectedDate.getMonth();
                      const hasEvt = sessions.some(s => s.isoDate === dayYMD);
                      
                      return (
                        <TouchableOpacity 
                          key={colIndex} 
                          style={[
                            { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
                            isTdy && { backgroundColor: '#165B74' },
                            isCurMonth ? {} : { opacity: 0.25 }
                          ]}
                          activeOpacity={0.7}
                          onPress={() => {
                            setSelectedDate(d);
                            setViewMode('week');
                            const idx = dateRange.findIndex(dr => toYMD(dr) === dayYMD);
                            if (idx >= 0) {
                              const sunIdx = idx - (idx % 7);
                              setTimeout(() => scrollRef.current?.scrollTo({ x: sunIdx * ITEM_WIDTH, animated: false }), 50);
                            }
                          }}
                        >
                           <Text style={{ fontFamily: isTdy ? 'Inter-Bold' : 'Inter-Medium', fontSize: 15, color: isTdy ? '#F4F6F6' : '#22271F' }}>{d.getDate()}</Text>
                           {hasEvt && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isTdy ? '#F4F6F6' : '#165B74', position: 'absolute', bottom: 4 }} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </GlassCard>
        ) : (
          <View style={{ marginBottom: 24, marginHorizontal: -20 }}>
            <GlassCard style={{ borderRadius:0, borderWidth:0, marginBottom:0 }} contentStyle={{ padding: 0 }}>
              <ScrollView
                ref={scrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={ITEM_WIDTH}
                contentContainerStyle={[
                  styles.stripContent,
                  { paddingHorizontal: viewMode === 'week' ? WEEK_PAD : CENTER_PAD }
                ]}
                onMomentumScrollEnd={(e) => {
                  const x = e.nativeEvent.contentOffset.x;
                  const idx = Math.round(x / ITEM_WIDTH);
                  if (idx >= 0 && idx < dateRange.length) setSelectedDate(dateRange[idx]);
                }}
              >
                {dateRange.map((d, i) => {
                  const dayYMD = toYMD(d);
                  const isSel = (viewMode === 'day' && dayYMD === selectedYMD); 
                  const isTdy = dayYMD===todayYMD;
                  const hasEvt = sessions.some(s => s.isoDate === dayYMD);
                  return (
                    <View key={i} style={styles.stripItemContainer}>
                      <TouchableOpacity
                        onPress={() => {
                          setSelectedDate(d);
                          setViewMode('day');
                          setTimeout(() => scrollRef.current?.scrollTo({ x: i * ITEM_WIDTH, animated: true }), 50);
                        }}
                        style={[
                          styles.dayCell,
                          isSel && { backgroundColor:'rgba(44,124,150,0.2)', borderWidth:1.5, borderColor:'#41785C' },
                          !isSel && isTdy && { backgroundColor:'#165B74' },
                        ]}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.dayLetter, isSel && { color:'#B15A4E' }, !isSel && isTdy && { color:'rgba(244,246,246,0.75)' }]}>{getDayLetter(d)}</Text>
                        <Text style={[styles.dayNum,    isSel && { color:'#22271F' }, !isSel && isTdy && { color:'#F4F6F6' }]}>{d.getDate()}</Text>
                        {hasEvt && <View style={[styles.eventDot, (isSel || isTdy) && { backgroundColor: '#F7F8F8' }]} />}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </GlassCard>
          </View>
        )}

        <Text style={styles.sectionLabel}>
          {viewMode==='week'?'THIS WEEK':selectedYMD===todayYMD?"TODAY'S EVENTS":'SELECTED EVENTS'}
        </Text>

        {filteredSessions.length === 0 ? (
          <GlassCard style={{ marginBottom:12 }} contentStyle={{ alignItems:'center', paddingVertical:36 }}>
            <Ionicons name="calendar-outline" size={34} color="rgba(34,39,31,0.32)" />
            <Text style={styles.emptyText}>No upcoming sessions scheduled.</Text>
          </GlassCard>
        ) : filteredSessions.map(s => {
          const ts = TAG_STYLE[s.tag], { day, date } = sessionDisplay(s.isoDate);
          return (
            <GlassCard key={s.id} style={{ marginBottom:12 }} onPress={() => setDetail(s)} rippleColor={ts.text}>
              <View style={styles.sessionRow}>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateBadgeNum}>{date}</Text>
                  <Text style={styles.dateBadgeMon}>{day.toUpperCase()}</Text>
                </View>
                <View style={{ flex:1 }}>
                  <Text style={styles.sessionTitle}>{s.title}</Text>
                  <View style={styles.metaRow}><Ionicons name="time-outline" size={12} color="rgba(34,39,31,0.4)" /><Text style={styles.metaTxt}>{s.time}</Text></View>
                  {s.location && <View style={styles.metaRow}><Ionicons name="location-outline" size={12} color="#2C7C96" /><Text style={[styles.metaTxt,{color:'#2C7C96'}]} numberOfLines={1}>{s.location}</Text></View>}
                </View>
                <Ionicons name="chevron-forward" size={15} color="rgba(34,39,31,0.32)" />
              </View>
            </GlassCard>
          );
        })}
      </ScrollView>

      {/* ── Session detail ───────────────────────────────────────────── */}
      <Modal visible={!!detail} transparent animationType="fade">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]}>
          <Pressable style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }} onPress={() => setDetail(null)}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <GlassCard style={{ marginBottom: 0 }} contentStyle={{ padding: 20 }}>
                {detail ? (
                  <>
                    <View style={styles.detailHeader}>
                      <Text style={styles.sheetTitle}>Event Details</Text>
                      <TouchableOpacity onPress={() => setDetail(null)} style={styles.closeBtn}>
                        <Ionicons name="close" size={20} color="#22271F" />
                      </TouchableOpacity>
                    </View>
                    <View style={{ marginBottom: 16 }}>
                      <View style={[styles.tagPill, { backgroundColor: TAG_STYLE[detail.tag].bg }]}>
                        <Text style={[styles.tagPillTxt, { color: TAG_STYLE[detail.tag].text }]}>{detail.tag}</Text>
                      </View>
                      <Text style={styles.detailTitle}>{detail.title}</Text>
                    </View>
                    <View style={styles.detailInfoBlock}>
                      <View style={styles.detailInfoRow}>
                        <Ionicons name="calendar-outline" size={15} color="#2C7C96" />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.detailLabel}>Date</Text>
                          <Text style={styles.detailValue}>{formatSessionLongDate(detail.start_time)}</Text>
                        </View>
                      </View>
                      <View style={styles.detailInfoRow}>
                        <Ionicons name="time-outline" size={15} color="#7A7A7A" />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.detailLabel}>Time</Text>
                          <Text style={styles.detailValue}>{formatSessionTimeRange(detail.start_time, detail.end_time)}</Text>
                        </View>
                      </View>
                      {detail.description ? (
                        <View style={styles.detailInfoRow}>
                          <Ionicons name="document-text-outline" size={15} color="#B08A3E" />
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.detailLabel}>Notes</Text>
                            <Text style={styles.detailValue}>{detail.description}</Text>
                          </View>
                        </View>
                      ) : null}
                    </View>

                    {/* Coverage — coordinators only */}
                    {coverage && coverage.total > 0 && (
                      <View style={styles.coverageBox}>
                        <View style={styles.coverageHead}>
                          <Text style={styles.coverageLabel}>COVERAGE</Text>
                          <Text style={styles.coverageCount}>{coverage.going} of {coverage.total} confirmed</Text>
                        </View>
                        <View style={styles.coverageTrack}>
                          <View style={[styles.coverageFillGoing, { width: `${(coverage.going / coverage.total) * 100}%` }]} />
                          <View style={[styles.coverageFillNo, { width: `${(coverage.notGoing / coverage.total) * 100}%` }]} />
                        </View>
                        {coverage.noResponse > 0 && (
                          <Text style={styles.coverageNote}>{coverage.noResponse} haven't responded yet</Text>
                        )}
                      </View>
                    )}

                    {/* RSVP */}
                    <Text style={styles.rsvpAsk}>Are you going?</Text>
                    <View style={styles.rsvpBtnRow}>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => persistDetailRsvp('going')}
                        style={[styles.rsvpBtn, detailRsvp === 'going' && styles.rsvpBtnGoing]}
                      >
                        <Ionicons name="checkmark-circle" size={16} color={detailRsvp === 'going' ? '#F4F6F6' : '#2C7C96'} />
                        <Text style={[styles.rsvpBtnTxt, detailRsvp === 'going' && { color: '#F4F6F6' }]}>I'm going</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.85}
                        onPress={() => persistDetailRsvp('not_going')}
                        style={[styles.rsvpBtn, detailRsvp === 'not_going' && styles.rsvpBtnNo]}
                      >
                        <Text style={[styles.rsvpBtnTxt, detailRsvp === 'not_going' && { color: '#F4F6F6' }]}>Can't make it</Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      style={styles.icsBtn}
                      activeOpacity={0.85}
                      disabled={exportingIcs}
                      onPress={() => exportSessionToCalendar(detail)}
                    >
                      {exportingIcs ? (
                        <ActivityIndicator size="small" color="#2C7C96" />
                      ) : (
                        <Ionicons name="calendar-outline" size={16} color="#2C7C96" />
                      )}
                      <Text style={styles.icsBtnTxt}>Add to Calendar</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </GlassCard>
            </Pressable>
          </Pressable>
        </View>
      </Modal>

      {/* ── Create Event Sheet ────────────────────────────────────────────── */}
      <Modal visible={showAddEvent} transparent animationType="slide">
        <View style={{ flex:1, justifyContent:'flex-end', backgroundColor:'rgba(0,0,0,0.5)' }}>
          <BlurView intensity={25} tint="light" style={StyleSheet.absoluteFillObject} />
          {/* Tap the empty area above the sheet to dismiss */}
          <Pressable style={{ flex: 1 }} onPress={() => setShowAddEvent(false)} />

          <ScrollView
            style={styles.addSheet}
            contentContainerStyle={styles.addSheetContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Handle */}
            <View style={{ alignItems:'center', paddingBottom:12 }}>
              <View style={styles.sheetHandle} />
            </View>

            {/* Header row with single-button mode toggle */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>New Event</Text>
              <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
                {/* Single toggle: shows current mode, tap to flip */}
                <TouchableOpacity
                  style={styles.modeToggleBtn}
                  onPress={() => setInputMode(m => m === 'wheels' ? 'type' : 'wheels')}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={inputMode === 'wheels' ? 'reorder-four-outline' : 'create-outline'}
                    size={12}
                    color="#2C7C96"
                  />
                  <Text style={styles.modeToggleTxt}>
                    {inputMode === 'wheels' ? 'Scroll' : 'Type'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowAddEvent(false)} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color="#22271F" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Title */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Title</Text>
              <View style={styles.glassInput}>
                <TextInput style={styles.fieldInput} placeholder="e.g. Saturday Tutoring"
                  placeholderTextColor="rgba(34,39,31,0.4)" value={title} onChangeText={setTitle} />
              </View>
            </View>

            {/* ── DATE ── */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Date (MM / DD / YYYY)</Text>

              {inputMode === 'type' ? (
                <View style={styles.glassInput}>
                  <TextInput style={styles.fieldInput} value={manualDate} onChangeText={setManualDate}
                    keyboardType="numbers-and-punctuation" placeholder="03/23/2026"
                    placeholderTextColor="rgba(34,39,31,0.4)" />
                </View>
              ) : (
                <View style={styles.pickerRow}>
                  <WheelPicker data={MONTHS} selected={selMonth} onSelect={setSelMonth} rowH={DATE_ROW_H} pickerH={DATE_PH} />
                  <WheelPicker data={DAYS}   selected={selDay}   onSelect={setSelDay}   rowH={DATE_ROW_H} pickerH={DATE_PH} />
                  <WheelPicker data={YEARS}  selected={selYear}  onSelect={setSelYear}  rowH={DATE_ROW_H} pickerH={DATE_PH} />
                </View>
              )}
            </View>

            {/* ── TIME: Start | Duration | End ── */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Time</Text>

              {inputMode === 'type' ? (
                <View style={{ gap: 12 }}>
                  {(['start', 'duration', 'end'] as TF[]).map(f => {
                    const isAuto = autoField === f;
                    const val = f === 'start' ? effStart : f === 'duration' ? effDur : effEnd;
                    const ph  = f === 'start' ? '10:00 AM' : f === 'duration' ? '2 hr' : '12:00 PM';
                    return (
                      <View key={f}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Text style={styles.subLabel}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
                          {isAuto && <View style={styles.autoChip}><Text style={styles.autoChipTxt}>AUTO</Text></View>}
                        </View>
                        <View style={[styles.glassInput, isAuto && { opacity: 0.5 }]}>
                          <TextInput
                            style={styles.fieldInput}
                            value={val}
                            onChangeText={txt => handleTimeChange(f, txt)}
                            placeholder={ph}
                            placeholderTextColor="rgba(34,39,31,0.4)"
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <>
                  {/* Column labels with dynamic AUTO indicator */}
                  <View style={styles.timeColLabels}>
                    {(['start','duration','end'] as const).map(f => (
                      <View key={f} style={{ flex:1, flexDirection:'row', alignItems:'center', gap:3 }}>
                        <Text style={styles.colLabel}>{f.toUpperCase()}</Text>
                        {autoField === f && <View style={styles.autoChip}><Text style={styles.autoChipTxt}>AUTO</Text></View>}
                      </View>
                    ))}
                  </View>

                  {/* Three side-by-side single-column scroll wheels */}
                  <View style={styles.pickerRow}>
                    <WheelPicker
                      data={TIME_SLOTS} selected={effStart}
                      onSelect={v => handleTimeChange('start', v)}
                      rowH={TIME_ROW_H} pickerH={TIME_PH}
                      isAuto={autoField === 'start'}
                    />
                    <WheelPicker
                      data={DUR_SLOTS} selected={effDur}
                      onSelect={v => handleTimeChange('duration', v)}
                      rowH={TIME_ROW_H} pickerH={TIME_PH}
                      isAuto={autoField === 'duration'}
                    />
                    <WheelPicker
                      data={TIME_SLOTS} selected={effEnd}
                      onSelect={v => handleTimeChange('end', v)}
                      rowH={TIME_ROW_H} pickerH={TIME_PH}
                      isAuto={autoField === 'end'}
                    />
                  </View>
                </>
              )}
            </View>

            {/* Location */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Location</Text>
              <View style={styles.glassInput}>
                <TextInput style={styles.fieldInput} placeholder="Type an address or place…"
                  placeholderTextColor="rgba(34,39,31,0.4)" value={location} onChangeText={setLocation} />
                <Ionicons name="map-outline" size={15} color="#2C7C96" style={{ marginRight:14 }} />
              </View>

              {location.length > 2 && (
                <View style={styles.mapCard}>
                  <Image
                    source={{ uri:`https://static-maps.yandex.ru/1.x/?l=map&z=14&size=600,180&pt=${encodeURIComponent(location)},pm2rdm&lang=en_US` }}
                    style={styles.mapImage} resizeMode="cover"
                  />
                  <BlurView intensity={40} tint="light" style={styles.mapOverlay}>
                    <Text style={styles.mapOverlayTxt} numberOfLines={1}>{location}</Text>
                  </BlurView>
                  <TouchableOpacity style={styles.mapNavBtn} onPress={() => openAppleMaps(location)}>
                    <Ionicons name="navigate-circle" size={28} color="#2C7C96" />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Repeats */}
            <View style={styles.fieldSection}>
              <Text style={styles.fieldLabel}>Repeats</Text>
              <View style={styles.repeatRow}>
                <View>
                  <Text style={styles.repeatLabel}>{repeatWeeks <= 1 ? 'None' : `Weekly · ${repeatWeeks} weeks`}</Text>
                  <Text style={styles.repeatSub}>{repeatWeeks <= 1 ? 'A single event' : `Creates ${repeatWeeks} sessions, 7 days apart`}</Text>
                </View>
                <View style={styles.repeatStepper}>
                  <TouchableOpacity
                    onPress={() => setRepeatWeeks(w => Math.max(1, w - 1))}
                    disabled={repeatWeeks <= 1}
                    style={[styles.repeatStepBtn, repeatWeeks <= 1 && styles.repeatStepBtnDisabled]}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="remove" size={16} color="#2C7C96" />
                  </TouchableOpacity>
                  <Text style={styles.repeatValue}>{repeatWeeks}</Text>
                  <TouchableOpacity
                    onPress={() => setRepeatWeeks(w => Math.min(12, w + 1))}
                    disabled={repeatWeeks >= 12}
                    style={[styles.repeatStepBtn, repeatWeeks >= 12 && styles.repeatStepBtnDisabled]}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="add" size={16} color="#2C7C96" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.createBtn, creating && { opacity: 0.6 }]}
              disabled={creating}
              onPress={handleCreateEvent}
            >
              <Text style={styles.createBtnTxt}>{creating ? 'Creating…' : repeatWeeks > 1 ? `Create ${repeatWeeks} Events` : 'Create Event'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const DATE_PH = DATE_ROW_H * 3;
const TIME_PH = TIME_ROW_H * 3;

const styles = StyleSheet.create({
  screen:        { flex:1, backgroundColor:colors.base },
  scrollContent: { paddingTop:72, paddingHorizontal:20, paddingBottom:140 },
  header:        { marginBottom:24 },
  headerControls:{ flexDirection:'row', alignItems:'center', gap:8, marginTop:16 },
  pageTitle:     { fontFamily:'Inter-Black', fontSize:34, color:'#22271F', letterSpacing:-1 },
  pageSubtitle:  { fontFamily:'Inter-Regular', fontSize:14, color:'rgba(34,39,31,0.45)', marginTop:3 },

  todayBtn:      { flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:12, height:34, borderRadius:12, backgroundColor:'rgba(196,196,196,0.08)', borderWidth:1, borderColor:'rgba(196,196,196,0.18)' },
  todayBtnTxt:   { fontFamily:'Inter-SemiBold', fontSize:13, color:'#165B74' },
  segment:       { flexDirection:'row', height:34, borderRadius:12, backgroundColor:'rgba(196,196,196,0.05)', borderWidth:1, borderColor:'rgba(196,196,196,0.14)', padding:3, gap:3 },
  segmentBtn:    { paddingHorizontal:12, borderRadius:9, alignItems:'center', justifyContent:'center' },
  segmentBtnActive: { backgroundColor:'rgba(196,196,196,0.14)', borderWidth:1, borderColor:'rgba(196,196,196,0.22)' },
  segmentTxt:    { fontFamily:'Inter-SemiBold', fontSize:13, color:'rgba(34,39,31,0.45)' },
  segmentTxtActive: { color:'#165B74' },
  addBtn:        { width:34, height:34, borderRadius:12, backgroundColor:'rgba(196,196,196,0.08)', borderWidth:1, borderColor:'rgba(196,196,196,0.18)', alignItems:'center', justifyContent:'center' },
  headerPill:    { flexDirection:'row', alignItems:'center', backgroundColor:'rgba(44,124,150,0.1)', borderWidth:1, borderColor:'rgba(44,124,150,0.25)', borderRadius:20, overflow:'hidden' },
  pillBtn:       { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:9, gap:4 },
  pillTxt:       { fontFamily:'Inter-Medium', fontSize:13, color:'#2C7C96' },
  pillDivider:   { width:1, height:20, backgroundColor:'rgba(44,124,150,0.3)' },
  stripContent:       { paddingHorizontal:170, paddingVertical:10 },
  stripItemContainer: { width:ITEM_WIDTH, alignItems:'center' },
  dayCell:   { alignItems:'center', width:44, paddingVertical:8, borderRadius:14 },
  dayLetter: { fontFamily:'Inter-Medium', fontSize:11, color:'rgba(34,39,31,0.35)', marginBottom:4 },
  dayNum:    { fontFamily:'Inter-SemiBold', fontSize:16, color:'rgba(34,39,31,0.45)' },
  eventDot:  { width:4, height:4, borderRadius:2, backgroundColor:'#B15A4E', marginTop:4 },
  sectionLabel: { fontFamily:'Inter-SemiBold', fontSize:11.5, color:'rgba(34,39,31,0.4)', letterSpacing:1.5, textTransform:'uppercase', marginBottom:14 },
  emptyText:    { fontFamily:'Inter-Regular', fontSize:14, color:'rgba(34,39,31,0.3)', marginTop:12 },
  sessionRow:   { flexDirection:'row', alignItems:'flex-start', gap:12 },
  dateBadge:    { width:50, height:56, borderRadius:14, backgroundColor:'rgba(196,196,196,0.16)', borderWidth:1, borderColor:'rgba(196,196,196,0.22)', alignItems:'center', justifyContent:'center', flexShrink:0 },
  dateBadgeNum: { fontFamily:'Inter-Bold', fontSize:21, color:'#22271F', lineHeight:24 },
  dateBadgeMon: { fontFamily:'Inter-Medium', fontSize:10, color:'#C77E72', letterSpacing:0.5 },
  sessionTitle: { fontFamily:'Inter-SemiBold', fontSize:15, color:'#22271F', marginBottom:4 },
  metaRow:      { flexDirection:'row', alignItems:'center', gap:5, marginBottom:2 },
  metaTxt:      { fontFamily:'Inter-Regular', fontSize:12, color:'rgba(34,39,31,0.5)' },

  // Sheet
  addSheet:        { backgroundColor:'#FFFFFF', borderTopLeftRadius:36, borderTopRightRadius:36, maxHeight:'95%', borderWidth:1, borderColor:'rgba(196,196,196,0.16)' },
  addSheetContent: { padding:20, paddingBottom:52 },
  sheetHandle:     { width:38, height:4, borderRadius:2, backgroundColor:'rgba(196,196,196,0.32)' },
  sheetHeader:     { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:20 },
  sheetTitle:      { fontFamily:'Inter-Bold', fontSize:24, color:'#22271F' },
  closeBtn:        { width:36, height:36, borderRadius:18, backgroundColor:'rgba(196,196,196,0.16)', alignItems:'center', justifyContent:'center' },

  // Mode toggle (single button)
  modeToggleBtn: { flexDirection:'row', alignItems:'center', gap:5, paddingHorizontal:11, paddingVertical:7, backgroundColor:'rgba(44,124,150,0.1)', borderRadius:12, borderWidth:1, borderColor:'rgba(44,124,150,0.25)' },
  modeToggleTxt: { fontFamily:'Inter-SemiBold', fontSize:12, color:'#2C7C96' },

  fieldSection: { marginBottom:20 },
  fieldLabel:   { fontFamily:'Inter-Medium', fontSize:11, color:'rgba(34,39,31,0.38)', textTransform:'uppercase', letterSpacing:1, marginBottom:10 },
  subLabel:     { fontFamily:'Inter-Medium', fontSize:11, color:'rgba(34,39,31,0.4)', marginBottom:6 },
  glassInput:   { backgroundColor:'rgba(196,196,196,0.12)', borderWidth:1, borderColor:'rgba(196,196,196,0.22)', borderRadius:16, flexDirection:'row', alignItems:'center' },
  fieldInput:   { flex:1, padding:14, fontFamily:'Inter-Regular', fontSize:15, color:'#22271F' },

  // Pickers
  pickerRow:     { flexDirection:'row', gap:8 },
  timeColLabels: { flexDirection:'row', marginBottom:6 },
  colLabel:      { fontFamily:'Inter-SemiBold', fontSize:10, color:'rgba(34,39,31,0.3)', textTransform:'uppercase', letterSpacing:1 },
  autoChip:      { backgroundColor:'rgba(44,124,150,0.12)', borderRadius:6, paddingHorizontal:5, paddingVertical:1, borderWidth:1, borderColor:'rgba(44,124,150,0.3)' },
  autoChipTxt:   { fontFamily:'Inter-Bold', fontSize:7.5, color:'#2C7C96', letterSpacing:0.5 },

  // Wheel picker
  wheelWrap:        { flex:1, overflow:'hidden', backgroundColor:'rgba(196,196,196,0.12)', borderRadius:14, borderWidth:1, borderColor:'rgba(196,196,196,0.16)' },
  wheelDisabled:    { opacity:0.45 },
  wheelTxt:         { fontFamily:'Inter-Medium', textAlign:'center' },
  wheelActive:      { color:'#2C7C96', fontSize:13 },
  wheelInactive:    { color:'rgba(34,39,31,0.32)', fontSize:11 },
  wheelRail:        { position:'absolute', left:6, right:6, backgroundColor:'rgba(44,124,150,0.1)', borderRadius:8, borderWidth:1, borderColor:'rgba(44,124,150,0.22)' },
  wheelFade:        { position:'absolute', left:0, right:0, height:18 },
  wheelFadeTop:     { top:0, backgroundColor:'rgba(255,253,247,0.9)' },
  wheelFadeBottom:  { bottom:0, backgroundColor:'rgba(255,253,247,0.9)' },

  // Map
  mapCard:       { marginTop:10, height:100, borderRadius:18, overflow:'hidden', borderWidth:1, borderColor:'rgba(196,196,196,0.22)' },
  mapImage:      { width:'100%', height:'100%' },
  mapOverlay:    { position:'absolute', bottom:0, left:0, right:0, paddingHorizontal:14, paddingVertical:8 },
  mapOverlayTxt: { fontFamily:'Inter-Medium', fontSize:11, color:'#22271F' },
  mapNavBtn:     { position:'absolute', top:8, right:10 },

  // Create
  createBtn:    { backgroundColor:colors.platinum, borderRadius:20, paddingVertical:18, alignItems:'center', marginTop:4 },
  createBtnTxt: { fontFamily:'Inter-Bold', fontSize:16, color:colors.base },

  detailHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  tagPill: { alignSelf:'flex-start', borderRadius:8, paddingHorizontal:8, paddingVertical:3, marginBottom:8 },
  tagPillTxt: { fontFamily:'Inter-Bold', fontSize:10, letterSpacing:0.8 },
  detailTitle: { fontFamily:'Inter-Bold', fontSize:22, color:'#22271F', letterSpacing:-0.3, lineHeight:28 },
  detailInfoBlock: { backgroundColor:'rgba(196,196,196,0.12)', borderRadius:16, padding:14, gap:12, borderWidth:1, borderColor:'rgba(196,196,196,0.16)' },
  detailInfoRow: { flexDirection:'row', alignItems:'flex-start' },
  detailLabel: { fontFamily:'Inter-Medium', fontSize:11, color:'rgba(34,39,31,0.4)', textTransform:'uppercase', letterSpacing:0.8, marginBottom:2 },
  detailValue: { fontFamily:'Inter-Medium', fontSize:14, color:'#22271F', lineHeight:20 },
  rsvpAsk: { fontFamily:'Inter-SemiBold', fontSize:12, color:'rgba(34,39,31,0.5)', letterSpacing:1, textTransform:'uppercase', marginTop:16, marginBottom:10 },
  rsvpBtnRow: { flexDirection:'row', gap:10 },
  rsvpBtn: { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:7, paddingVertical:13, borderRadius:14, borderWidth:1, borderColor:'rgba(196,196,196,0.22)', backgroundColor:'rgba(196,196,196,0.05)' },
  rsvpBtnGoing: { backgroundColor:'#2C7C96', borderColor:'#2C7C96' },
  rsvpBtnNo: { backgroundColor:'#B15A4E', borderColor:'#B15A4E' },
  rsvpBtnTxt: { fontFamily:'Inter-SemiBold', fontSize:14, color:'#22271F' },
  coverageBox: { marginTop:16, backgroundColor:'rgba(196,196,196,0.06)', borderRadius:14, padding:14, borderWidth:1, borderColor:'rgba(196,196,196,0.14)' },
  coverageHead: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:9 },
  coverageLabel: { fontFamily:'Inter-Bold', fontSize:10.5, color:'#2C7C96', letterSpacing:1.5 },
  coverageCount: { fontFamily:'Inter-SemiBold', fontSize:13, color:'#22271F' },
  coverageTrack: { flexDirection:'row', height:7, borderRadius:4, overflow:'hidden', backgroundColor:'rgba(196,196,196,0.12)' },
  coverageFillGoing: { height:'100%', backgroundColor:'#2C7C96' },
  coverageFillNo: { height:'100%', backgroundColor:'#B15A4E' },
  coverageNote: { fontFamily:'Inter-Regular', fontSize:11.5, color:'rgba(34,39,31,0.5)', marginTop:8 },

  icsBtn: { flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, marginTop:12, paddingVertical:13, borderRadius:14, borderWidth:1, borderColor:'rgba(44,124,150,0.3)', backgroundColor:'rgba(44,124,150,0.08)' },
  icsBtnTxt: { fontFamily:'Inter-SemiBold', fontSize:13.5, color:'#2C7C96' },

  // Repeat stepper
  repeatRow: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:'rgba(196,196,196,0.12)', borderWidth:1, borderColor:'rgba(196,196,196,0.22)', borderRadius:16, paddingHorizontal:14, paddingVertical:12 },
  repeatLabel: { fontFamily:'Inter-Medium', fontSize:14.5, color:'#22271F' },
  repeatSub: { fontFamily:'Inter-Regular', fontSize:12, color:'rgba(34,39,31,0.45)', marginTop:2 },
  repeatStepper: { flexDirection:'row', alignItems:'center', gap:14 },
  repeatStepBtn: { width:30, height:30, borderRadius:15, backgroundColor:'rgba(44,124,150,0.12)', alignItems:'center', justifyContent:'center' },
  repeatStepBtnDisabled: { opacity:0.35 },
  repeatValue: { fontFamily:'Inter-Bold', fontSize:16, color:'#22271F', minWidth:20, textAlign:'center' },
});
