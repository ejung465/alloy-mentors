import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  Modal, StyleSheet, Animated, Pressable, TextInput, KeyboardAvoidingView, Platform, Alert
} from 'react-native';
import { GlassCard } from '@/components/ui/GlassCard';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

// ── Types ────────────────────────────────────────────────────────────────────
type ChatType = 'org' | 'dm' | 'group_chat';

type ActiveChat =
  | { type: 'org'; id: 'org'; full_name: string; onlineCount?: number }
  | { type: 'dm'; id: string; full_name: string; role: string; [key: string]: any }
  | { type: 'group_chat'; id: string; full_name: string; memberCount: number };

type GroupChat = {
  id: string;
  name: string;
  created_by: string;
  memberCount: number;
};

// ── AnimPress helper ─────────────────────────────────────────────────────────
function AnimPress({ children, onPress, style }: any) {
  const s = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => Animated.spring(s, { toValue: 0.95, useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPressOut={() => Animated.spring(s, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPress={onPress} style={style}
    >
      <Animated.View style={{ transform: [{ scale: s }], flex: 1 }}>{children}</Animated.View>
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const { profile, org } = useUser();
  const membersLabel = org?.memberNounPlural || 'Members';
  const orgName = org?.name || 'your organization';

  // Directory
  const [orgUsers, setOrgUsers]     = useState<any[]>([]);
  const [groupChats, setGroupChats] = useState<GroupChat[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [search, setSearch]         = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatTab, setNewChatTab]  = useState<'dm' | 'group'>('dm');

  // Group creation
  const [groupName, setGroupName]             = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup]     = useState(false);

  // Moderation
  const [onlineUsers, setOnlineUsers] = useState<Record<string, any>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [blockedIds, setBlockedIds]   = useState<string[]>([]);
  const [reactions, setReactions]     = useState<Record<string, { user_id: string; emoji: string }[]>>({});
  const [msgAction, setMsgAction]     = useState<any | null>(null);
  const [editTarget, setEditTarget]   = useState<any | null>(null);
  const [editText, setEditText]       = useState('');
  const [showReport, setShowReport]   = useState<{ msgId: string; content: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Chat thread
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [messages, setMessages]       = useState<any[]>([]);
  const [newMessage, setNewMessage]   = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]         = useState(true);
  const scrollViewRef = useRef<ScrollView>(null);
  const channelRef = useRef<any>(null);
  const PAGE_SIZE = 25;

  // ── Fetch directory + groups ────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUser(user);

    // Blocks in BOTH directions: people I blocked AND people who blocked me.
    const { data: blocks } = await supabase
      .from('blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`);
    if (blocks) setBlockedIds(blocks.map((b: any) => (b.blocker_id === user.id ? b.blocked_id : b.blocker_id)));

    let q = supabase.from('users').select('*').neq('id', user.id);
    if (profile?.organization_id) q = q.eq('organization_id', profile.organization_id);
    const { data: users } = await q;
    setOrgUsers(users || []);

    // Fetch groups the user belongs to
    const { data: membership } = await supabase
      .from('group_chat_members')
      .select('group_chat_id, group_chats(id, name, created_by)')
      .eq('user_id', user.id);

    if (membership) {
      const groupIds = membership.map((m: any) => m.group_chats?.id).filter(Boolean);
      // One query for all member rows across every group, counted client-side —
      // avoids firing a separate count query per group chat.
      const { data: allMembers } = groupIds.length
        ? await supabase.from('group_chat_members').select('group_chat_id').in('group_chat_id', groupIds)
        : { data: [] as { group_chat_id: string }[] };
      const counts = new Map<string, number>();
      (allMembers || []).forEach((r: any) => counts.set(r.group_chat_id, (counts.get(r.group_chat_id) ?? 0) + 1));

      const groups = membership
        .map((m: any) => {
          const gc = m.group_chats;
          if (!gc) return null;
          return { id: gc.id, name: gc.name, created_by: gc.created_by, memberCount: counts.get(gc.id) ?? 0 };
        })
        .filter(Boolean) as GroupChat[];
      setGroupChats(groups);
    }
  }, [profile?.organization_id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  const onRefresh = async () => { setRefreshing(true); await fetchAll(); setRefreshing(false); };

  // ── Create group ────────────────────────────────────────────────────────────
  const createGroup = async () => {
    if (!groupName.trim()) { Alert.alert('Required', 'Enter a group name.'); return; }
    if (selectedMembers.length === 0) { Alert.alert('Required', 'Add at least one member.'); return; }
    setCreatingGroup(true);

    const { data: group, error } = await supabase
      .from('group_chats')
      .insert({ name: groupName.trim(), organization_id: profile?.organization_id, created_by: currentUser.id })
      .select()
      .single();

    if (error || !group) {
      Alert.alert('Error', error?.message ?? 'Could not create group.');
      setCreatingGroup(false);
      return;
    }

    const members = [...new Set([...selectedMembers, currentUser.id])];
    await supabase.from('group_chat_members').insert(
      members.map((uid) => ({ group_chat_id: group.id, user_id: uid }))
    );

    setCreatingGroup(false);
    setShowNewChat(false);
    setGroupName('');
    setSelectedMembers([]);
    await fetchAll();
    setActiveChat({ type: 'group_chat', id: group.id, full_name: group.name, memberCount: members.length });
  };

  // ── Message query helpers ───────────────────────────────────────────────────
  const buildQuery = (chat: ActiveChat, before?: string) => {
    let q = supabase.from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (before) q = q.lt('created_at', before);

    if (chat.type === 'org') {
      return q.is('receiver_id', null).is('group_chat_id', null)
        .eq('organization_id', profile?.organization_id ?? '');
    }
    if (chat.type === 'group_chat') {
      return q.eq('group_chat_id', chat.id);
    }
    // DM
    return q.or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${chat.id}),and(sender_id.eq.${chat.id},receiver_id.eq.${currentUser.id})`
    ).is('group_chat_id', null);
  };

  // ── Realtime subscription ───────────────────────────────────────────────────
  useEffect(() => {
    setTypingUsers({});
    if (!activeChat || !currentUser) { setMessages([]); setHasMore(true); return; }

    const loadReactions = async (ids: string[]) => {
      if (ids.length === 0) return;
      const { data } = await supabase.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids);
      if (data) {
        const map: Record<string, { user_id: string; emoji: string }[]> = {};
        data.forEach((r: any) => { (map[r.message_id] ||= []).push({ user_id: r.user_id, emoji: r.emoji }); });
        setReactions(map);
      }
    };

    const loadHistory = async () => {
      const { data } = await buildQuery(activeChat);
      if (data) {
        setMessages([...data].reverse());
        setHasMore(data.length === PAGE_SIZE);
        loadReactions(data.map((m: any) => m.id));
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
      }
    };
    setReactions({});
    loadHistory();

    const chanKey = activeChat.type === 'org' ? 'org' : activeChat.id;
    const channel = supabase.channel(`chat_${chanKey}`, {
      config: { presence: { key: currentUser.id } },
    })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as any;
        let belongsHere = false;
        if (activeChat.type === 'org') {
          belongsHere = msg.receiver_id === null && !msg.group_chat_id
            && msg.organization_id === profile?.organization_id;
        } else if (activeChat.type === 'group_chat') {
          belongsHere = msg.group_chat_id === activeChat.id;
        } else {
          belongsHere = !msg.group_chat_id && (
            (msg.sender_id === currentUser.id && msg.receiver_id === activeChat.id) ||
            (msg.sender_id === activeChat.id && msg.receiver_id === currentUser.id)
          );
        }
        if (!belongsHere) return;

        if (msg.sender_id !== currentUser.id) {
          // Read receipts only apply to DMs (RLS only allows updating where receiver_id = me).
          if (activeChat.type === 'dm') {
            supabase.from('messages').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', msg.id).then();
          }
        }

        setMessages((prev) => {
          const existing = prev.findIndex(
            (m) => m.id === msg.id || (m.tempId && m.content === msg.content && m.sender_id === msg.sender_id && m.status === 'sending')
          );
          if (existing > -1) {
            const next = [...prev];
            next[existing] = { ...msg, status: msg.sender_id === currentUser.id ? 'sent' : 'read' };
            return next;
          }
          return [...prev, { ...msg, status: msg.sender_id === currentUser.id ? 'sent' : 'read' }];
        });
        setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as any;
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
      })
      // Tapbacks — filter client-side to messages in this thread.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload) => {
        const row = (payload.new ?? payload.old) as any;
        if (!row?.message_id) return;
        setReactions((prev) => {
          const list = (prev[row.message_id] ?? []).filter((r) => r.user_id !== row.user_id);
          if (payload.eventType !== 'DELETE') list.push({ user_id: row.user_id, emoji: (payload.new as any).emoji });
          return { ...prev, [row.message_id]: list };
        });
      })
      .on('broadcast', { event: 'typing' }, (payload) => {
        const { userId, typing } = payload.payload;
        setTypingUsers((prev) => ({ ...prev, [userId]: typing }));
      })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const online: Record<string, boolean> = {};
        Object.keys(state).forEach((uid) => { online[uid] = true; });
        setOnlineUsers(online);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeChat, currentUser]);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore || !activeChat || !currentUser || messages.length === 0) return;
    setLoadingMore(true);
    const { data } = await buildQuery(activeChat, messages[0].created_at);
    if (data && data.length > 0) {
      setMessages((prev) => [...[...data].reverse(), ...prev]);
      setHasMore(data.length === PAGE_SIZE);
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  // ── Typing broadcast ────────────────────────────────────────────────────────
  const typingTimer = useRef<any>(null);
  const handleTyping = (text: string) => {
    setNewMessage(text);
    if (!currentUser || !activeChat) return;
    // Reuse the SAME subscribed channel — creating a second channel with the
    // same topic throws ("tried to subscribe multiple times").
    const chan = channelRef.current;
    if (!chan) return;
    chan.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUser.id, typing: true } });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      chan.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUser.id, typing: false } });
    }, 1500);
  };

  // ── PII guard ───────────────────────────────────────────────────────────────
  const hasPII = (text: string) => {
    const phoneRe = /(\d{3}[-\s]?\d{3}[-\s]?\d{4})|(\(\d{3}\)\s?\d{3}[-\s]?\d{4})/;
    const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const addrRe = /\b(address|street|\d+\s+\w+\s+(st|ave|rd|drive|dr|blvd|lane|ln)|apartment|apt)\b/i;
    return phoneRe.test(text) || emailRe.test(text) || addrRe.test(text);
  };

  // ── Send ────────────────────────────────────────────────────────────────────
  const sendMessage = () => {
    if (!newMessage.trim() || !currentUser || !activeChat) return;
    const content = newMessage.trim();
    if (hasPII(content)) {
      Alert.alert(
        'Keep it in-app',
        "This message looks like it contains personal contact info. For everyone's safety, please keep communication inside Alloy.",
        [
          { text: 'Edit', style: 'cancel' },
          { text: 'Send anyway', style: 'destructive', onPress: () => doSend(content) },
        ]
      );
      return;
    }
    doSend(content);
  };

  const doSend = async (content: string) => {
    if (!currentUser || !activeChat) return;
    const tempId = Math.random().toString(36).substring(7);
    const optimistic: any = {
      id: tempId, tempId, content,
      sender_id: currentUser.id,
      receiver_id: activeChat.type === 'dm' ? activeChat.id : null,
      group_chat_id: activeChat.type === 'group_chat' ? activeChat.id : null,
      created_at: new Date().toISOString(),
      status: 'sending',
    };
    setMessages((prev) => [...prev, optimistic]);
    setNewMessage('');
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 50);

    const { data, error } = await supabase.from('messages').insert({
      content,
      sender_id: currentUser.id,
      receiver_id: activeChat.type === 'dm' ? activeChat.id : null,
      group_chat_id: activeChat.type === 'group_chat' ? activeChat.id : null,
      organization_id: profile?.organization_id ?? null,
    }).select().single();

    if (error) {
      setMessages((prev) => prev.map((m) => m.tempId === tempId ? { ...m, status: 'error' } : m));
    } else if (data) {
      setMessages((prev) => prev.map((m) => m.tempId === tempId ? { ...data, status: 'sent' } : m));
    }
  };

  const retryMessage = async (tempId: string, content: string) => {
    setMessages((prev) => prev.map((m) => m.tempId === tempId ? { ...m, status: 'sending' } : m));
    if (!currentUser || !activeChat) return;
    const { data, error } = await supabase.from('messages').insert({
      content, sender_id: currentUser.id,
      receiver_id: activeChat.type === 'dm' ? activeChat.id : null,
      group_chat_id: activeChat.type === 'group_chat' ? activeChat.id : null,
      organization_id: profile?.organization_id ?? null,
    }).select().single();
    if (error) {
      setMessages((prev) => prev.map((m) => m.tempId === tempId ? { ...m, status: 'error' } : m));
    } else if (data) {
      setMessages((prev) => prev.map((m) => m.tempId === tempId ? { ...data, status: 'sent' } : m));
    }
  };

  // ── Moderation ──────────────────────────────────────────────────────────────
  const blockUser = async (targetId: string) => {
    if (!currentUser) return;
    // Idempotent: re-blocking an already-blocked user shouldn't error on the unique constraint.
    const { error } = await supabase
      .from('blocks')
      .upsert({ blocker_id: currentUser.id, blocked_id: targetId }, { onConflict: 'blocker_id,blocked_id' });
    if (!error) {
      setBlockedIds((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]));
      setActiveChat(null);
    } else {
      Alert.alert('Could not block', error.message);
    }
  };

  const leaveGroup = () => {
    if (!currentUser || !activeChat || activeChat.type !== 'group_chat') return;
    Alert.alert(
      'Leave Group',
      `Leave "${activeChat.full_name}"? You won't receive messages from this group anymore.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive',
          onPress: async () => {
            await supabase.from('group_chat_members')
              .delete()
              .eq('group_chat_id', activeChat.id)
              .eq('user_id', currentUser.id);
            setActiveChat(null);
            fetchAll();
          },
        },
      ]
    );
  };

  const submitReport = async (msgId: string, reason: string) => {
    if (!currentUser) return;
    const { error } = await supabase.from('message_reports').insert({ reporter_id: currentUser.id, message_id: msgId, reason });
    setShowReport(null);
    if (error) Alert.alert('Could not report', 'That message could not be reported. Please try again.');
    else Alert.alert('Reported', `Your report has been sent to ${orgName} admins.`);
  };

  // ── iMessage actions: tapbacks, edit, unsend ───────────────────────────────
  const TAPBACKS = ['\u2764\ufe0f', '\ud83d\udc4d', '\ud83d\udc4e', '\ud83d\ude02', '\u203c\ufe0f', '\u2753'];

  const toggleReaction = async (msg: any, emoji: string) => {
    if (!currentUser || !msg?.id || msg.tempId) return;
    setMsgAction(null);
    const mine = (reactions[msg.id] ?? []).find((r) => r.user_id === currentUser.id);
    if (mine && mine.emoji === emoji) {
      // Optimistic remove
      setReactions((prev) => ({ ...prev, [msg.id]: (prev[msg.id] ?? []).filter((r) => r.user_id !== currentUser.id) }));
      await supabase.from('message_reactions').delete().eq('message_id', msg.id).eq('user_id', currentUser.id);
    } else {
      setReactions((prev) => ({
        ...prev,
        [msg.id]: [...(prev[msg.id] ?? []).filter((r) => r.user_id !== currentUser.id), { user_id: currentUser.id, emoji }],
      }));
      const { error } = await supabase
        .from('message_reactions')
        .upsert({ message_id: msg.id, user_id: currentUser.id, emoji }, { onConflict: 'message_id,user_id' });
      if (error) Alert.alert('Could not react', 'Run migration 0018 if this persists.');
    }
  };

  const canEditMsg = (msg: any) =>
    currentUser && msg.sender_id === currentUser.id && !msg.deleted_at &&
    Date.now() - new Date(msg.created_at).getTime() < 15 * 60 * 1000;

  const unsendMessage = (msg: any) => {
    setMsgAction(null);
    Alert.alert('Unsend message?', 'It will be removed for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsend', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('messages')
            .update({ deleted_at: new Date().toISOString() }).eq('id', msg.id);
          if (error) Alert.alert('Could not unsend', error.message);
          else setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, deleted_at: new Date().toISOString() } : m)));
        },
      },
    ]);
  };

  const saveEdit = async () => {
    if (!editTarget || !editText.trim()) return;
    const { error } = await supabase.from('messages')
      .update({ content: editText.trim(), edited_at: new Date().toISOString() })
      .eq('id', editTarget.id);
    if (error) { Alert.alert('Could not edit', error.message); return; }
    setMessages((prev) => prev.map((m) => (m.id === editTarget.id ? { ...m, content: editText.trim(), edited_at: new Date().toISOString() } : m)));
    setEditTarget(null); setEditText('');
  };

  // ── Date divider ────────────────────────────────────────────────────────────
  const getDateDivider = (dateStr: string) => {
    const d = new Date(dateStr);
    const today = new Date(), yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const visibleUsers = orgUsers.filter((u) => !blockedIds.includes(u.id));
  // Hide messages from blocked users (either direction) in any thread.
  const visibleMessages = messages.filter((m) => !blockedIds.includes(m.sender_id));
  const filteredUsers = search
    ? visibleUsers.filter((u) => u.full_name?.toLowerCase().includes(search.toLowerCase()))
    : visibleUsers;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <AuroraBackground />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.pageTitle}>Messages</Text>
          <Text style={styles.pageSubtitle}>Connect with your team</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} activeOpacity={0.8} onPress={() => { setSearch(''); setNewChatTab('dm'); setGroupName(''); setSelectedMembers([]); setShowNewChat(true); }}>
            <Ionicons name="add" size={20} color="#22271F" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22271F" />}
      >
        {/* Org group chat */}
        <AnimPress onPress={() => setActiveChat({ type: 'org', id: 'org', full_name: `All ${membersLabel}`, onlineCount: orgUsers.length + 1 })} style={{ marginBottom: 16 }}>
          <GlassCard style={{ borderColor: 'rgba(44,124,150,0.4)', borderWidth: 1.5 }}>
            <View style={styles.memberRow}>
              <View style={[styles.avatarWrap, { backgroundColor: 'rgba(44,124,150,0.18)', borderColor: 'rgba(44,124,150,0.3)', width: 54, height: 54, borderRadius: 27 }]}>
                <Ionicons name="people" size={24} color="#41785C" />
                <View style={[styles.onlineDot, { backgroundColor: '#2C7C96' }]} />
              </View>
              <View style={{ flex: 1, marginLeft: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={[styles.memberName, { color: '#41785C', fontSize: 17 }]}>All {membersLabel}</Text>
                  <Text style={styles.memberTime}>{Object.keys(onlineUsers).length > 0 ? 'Active now' : 'Idle'}</Text>
                </View>
                <Text style={[styles.memberRole, { color: 'rgba(34,39,31,0.5)' }]}>
                  Org Chat · {orgUsers.length + 1} Members
                </Text>
              </View>
            </View>
          </GlassCard>
        </AnimPress>

        {/* Custom group chats */}
        {groupChats.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>GROUPS</Text>
            {groupChats.map((gc) => (
              <AnimPress key={gc.id} onPress={() => setActiveChat({ type: 'group_chat', id: gc.id, full_name: gc.name, memberCount: gc.memberCount })} style={{ marginBottom: 12 }}>
                <GlassCard>
                  <View style={styles.memberRow}>
                    <View style={[styles.avatarWrap, { backgroundColor: 'rgba(94,116,136,0.15)', borderColor: 'rgba(94,116,136,0.3)' }]}>
                      <Ionicons name="people-circle-outline" size={22} color="#7A7A7A" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{gc.name}</Text>
                      <Text style={styles.memberRole}>{gc.memberCount} members</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.3)" />
                  </View>
                </GlassCard>
              </AnimPress>
            ))}
          </>
        )}

        {/* DMs */}
        <Text style={styles.sectionLabel}>DIRECT MESSAGES</Text>
        {visibleUsers.length === 0 ? (
          <GlassCard style={{ marginBottom: 16 }} contentStyle={{ alignItems: 'center', padding: 40 }}>
            <Ionicons name="chatbubbles-outline" size={44} color="rgba(34,39,31,0.3)" />
            <Text style={styles.emptyTitle}>No members yet</Text>
            <Text style={styles.emptySubtitle}>Other team members will appear when they join on their devices.</Text>
          </GlassCard>
        ) : (
          visibleUsers.map((u) => (
            <AnimPress key={u.id} onPress={() => setActiveChat({ type: 'dm', id: u.id, full_name: u.full_name, role: u.role, school: u.school })} style={{ marginBottom: 12 }}>
              <GlassCard>
                <View style={styles.memberRow}>
                  <View style={styles.avatarWrap}>
                    <Text style={styles.avatarText}>{u.full_name?.charAt(0).toUpperCase() || 'U'}</Text>
                    {onlineUsers[u.id] && <View style={[styles.onlineDot, { backgroundColor: '#2C7C96' }]} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                      <Text style={styles.memberName}>{u.full_name || 'Member'}</Text>
                      <Text style={styles.memberTime}>{onlineUsers[u.id] ? 'Online' : 'Offline'}</Text>
                    </View>
                    <Text style={[styles.memberRole, { color: u.role === 'admin' ? '#2C7C96' : u.role === 'director' ? '#7A7A7A' : 'rgba(34,39,31,0.45)' }]}>
                      {u.role} · {u.school || 'Member'}
                    </Text>
                  </View>
                </View>
              </GlassCard>
            </AnimPress>
          ))
        )}
      </ScrollView>

      {/* ── New Chat / New Group Sheet ────────────────────────────────────── */}
      <Modal visible={showNewChat} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={styles.newChatBackdrop}>
          <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFillObject} />
          <Pressable style={{ flex: 1 }} onPress={() => setShowNewChat(false)} />
          <View style={styles.newChatSheet}>
            <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFillObject} />
            <View style={styles.newChatTop}>
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{newChatTab === 'dm' ? 'New Message' : 'New Group'}</Text>
                <TouchableOpacity onPress={() => setShowNewChat(false)} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color="#22271F" />
                </TouchableOpacity>
              </View>
              {/* Tab toggle */}
              <View style={styles.tabToggle}>
                {(['dm', 'group'] as const).map((tab) => (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => setNewChatTab(tab)}
                    style={[styles.tabBtn, newChatTab === tab && styles.tabBtnActive]}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={tab === 'dm' ? 'person-outline' : 'people-outline'} size={15} color={newChatTab === tab ? '#165B74' : 'rgba(34,39,31,0.4)'} />
                    <Text style={[styles.tabLabel, newChatTab === tab && styles.tabLabelActive]}>
                      {tab === 'dm' ? 'Direct Message' : 'New Group'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {newChatTab === 'group' && (
                <TextInput
                  style={styles.groupNameInput}
                  placeholder="Group name…"
                  placeholderTextColor="rgba(34,39,31,0.4)"
                  value={groupName}
                  onChangeText={setGroupName}
                />
              )}
              <View style={styles.searchBar}>
                <Ionicons name="search" size={16} color="rgba(34,39,31,0.4)" />
                <TextInput
                  style={styles.searchInput}
                  placeholder={newChatTab === 'dm' ? 'Search members…' : 'Add members…'}
                  placeholderTextColor="rgba(34,39,31,0.4)"
                  value={search}
                  onChangeText={setSearch}
                  autoFocus
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <Ionicons name="close-circle" size={16} color="rgba(34,39,31,0.4)" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
              {filteredUsers.map((u) => {
                const isSel = selectedMembers.includes(u.id);
                return (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => {
                      if (newChatTab === 'dm') {
                        setShowNewChat(false);
                        setSearch('');
                        setActiveChat({ type: 'dm', id: u.id, full_name: u.full_name, role: u.role, school: u.school });
                      } else {
                        setSelectedMembers((prev) => isSel ? prev.filter((id) => id !== u.id) : [...prev, u.id]);
                      }
                    }}
                    style={styles.memberSelectRow}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.avatarWrap, { width: 44, height: 44, borderRadius: 22 }]}>
                      <Text style={[styles.avatarText, { fontSize: 18 }]}>{u.full_name?.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.memberName}>{u.full_name}</Text>
                      <Text style={styles.memberRole}>{u.role}</Text>
                    </View>
                    {newChatTab === 'group' && (
                      <View style={[styles.checkCircle, isSel && styles.checkCircleSel]}>
                        {isSel && <Ionicons name="checkmark" size={14} color="#F4F6F6" />}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Create group button */}
            {newChatTab === 'group' && (
              <View style={styles.createGroupFooter}>
                {selectedMembers.length > 0 && (
                  <Text style={styles.createGroupCount}>{selectedMembers.length} member{selectedMembers.length > 1 ? 's' : ''} selected</Text>
                )}
                <TouchableOpacity
                  style={[styles.createGroupBtn, (creatingGroup || !groupName.trim() || !selectedMembers.length) && styles.createGroupBtnDisabled]}
                  onPress={createGroup}
                  disabled={creatingGroup || !groupName.trim() || selectedMembers.length === 0}
                  activeOpacity={0.85}
                >
                  <Text style={styles.createGroupBtnTxt}>{creatingGroup ? 'Creating…' : 'Create Group'}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Chat Thread Modal ─────────────────────────────────────────────── */}
      <Modal visible={!!activeChat} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.chatHeader}>
            <TouchableOpacity onPress={() => setActiveChat(null)} style={styles.closeBtn}>
              <Ionicons name="chevron-down" size={22} color="#22271F" />
            </TouchableOpacity>
            <View style={styles.chatAvatar}>
              {activeChat?.type !== 'dm' ? (
                <Ionicons name="people" size={20} color={activeChat?.type === 'group_chat' ? '#7A7A7A' : '#2C7C96'} />
              ) : (
                <Text style={styles.avatarText}>{(activeChat as any)?.full_name?.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.chatName}>{activeChat?.full_name}</Text>
              <Text style={styles.onlineTxt}>
                {activeChat?.type === 'org'
                  ? `${(activeChat as any).onlineCount ?? orgUsers.length + 1} Members`
                  : activeChat?.type === 'group_chat'
                  ? `${(activeChat as any).memberCount} members`
                  : (activeChat as any)?.role}
              </Text>
            </View>
            {(activeChat?.type === 'dm' || activeChat?.type === 'group_chat') && (
              <TouchableOpacity
                style={styles.closeBtn}
                activeOpacity={0.8}
                onPress={() => {
                  if (activeChat.type === 'group_chat') {
                    leaveGroup();
                  } else {
                    Alert.alert(
                      'Block User',
                      `Block ${activeChat.full_name}? They won't be able to message you.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Block', style: 'destructive', onPress: () => blockUser(activeChat.id) },
                      ]
                    );
                  }
                }}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color="rgba(34,39,31,0.7)" />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView
            ref={scrollViewRef}
            onScroll={(e) => { if (e.nativeEvent.contentOffset.y < 50) loadMoreMessages(); }}
            scrollEventThrottle={16}
            contentContainerStyle={{ padding: 20, gap: 2, paddingBottom: 40 }}
          >
            <View style={styles.dateChip}><Text style={styles.dateChipTxt}>Connection Secured</Text></View>
            {loadingMore && <Text style={{ color: 'rgba(34,39,31,0.3)', fontSize: 12, textAlign: 'center', paddingVertical: 8 }}>Loading history…</Text>}

            {visibleMessages.length === 0 ? (
              <View style={{ alignItems: 'center', padding: 40 }}>
                <Ionicons name="chatbox-ellipses-outline" size={40} color="rgba(34,39,31,0.32)" />
                <Text style={{ fontFamily: 'Inter-Medium', color: 'rgba(34,39,31,0.4)', marginTop: 10 }}>Start the conversation</Text>
              </View>
            ) : (
              visibleMessages.map((m, i) => {
                const isMe = m.sender_id === currentUser?.id;
                const prev = visibleMessages[i - 1];
                const next = visibleMessages[i + 1];
                const isGroupHeader = !prev || prev.sender_id !== m.sender_id ||
                  new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 300000;
                const isGroupFooter = !next || next.sender_id !== m.sender_id;
                const showDate = !prev || new Date(m.created_at).toDateString() !== new Date(prev.created_at).toDateString();
                const senderName = isMe ? 'Me' : orgUsers.find((u) => u.id === m.sender_id)?.full_name || 'Member';

                return (
                  <View key={m.id || m.tempId}>
                    {showDate && (
                      <View style={styles.dateDivider}>
                        <View style={styles.divideLine} />
                        <Text style={styles.divideText}>{getDateDivider(m.created_at)}</Text>
                        <View style={styles.divideLine} />
                      </View>
                    )}
                    <View style={[isMe ? styles.bubbleSentWrap : styles.bubbleRecvWrap, { marginTop: isGroupHeader ? 12 : 1 }]}>
                      {!isMe && isGroupHeader && activeChat?.type !== 'dm' && (
                        <Text style={styles.senderNameTxt}>{senderName}</Text>
                      )}
                      {m.deleted_at ? (
                        <Text style={styles.unsentTxt}>
                          {isMe ? 'You unsent a message' : `${senderName.split(' ')[0]} unsent a message`}
                        </Text>
                      ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onLongPress={() => {
                            // Only persisted (real UUID) messages get actions; skip optimistic/unsent.
                            if (m.tempId || m.status === 'sending' || m.status === 'error') return;
                            setMsgAction(m);
                          }}
                          style={[
                            isMe ? styles.bubbleSent : styles.bubbleRecv,
                            !isGroupFooter && (isMe ? { borderBottomRightRadius: 20 } : { borderBottomLeftRadius: 20 }),
                            m.status === 'sending' && { opacity: 0.6 },
                            m.status === 'error' && { borderWidth: 1, borderColor: '#B15A4E' },
                            (reactions[m.id]?.length ?? 0) > 0 && { marginTop: 12 },
                          ]}
                        >
                          <Text style={isMe ? styles.bubbleTxtSent : styles.bubbleTxt}>{m.content}</Text>
                          {/* tapback pill overlapping the top corner */}
                          {(reactions[m.id]?.length ?? 0) > 0 && (
                            <View style={[styles.reactPill, isMe ? { left: -10 } : { right: -10 }]}>
                              {Object.entries(
                                (reactions[m.id] ?? []).reduce((acc: Record<string, number>, r) => {
                                  acc[r.emoji] = (acc[r.emoji] ?? 0) + 1; return acc;
                                }, {})
                              ).map(([emoji, count]) => (
                                <Text key={emoji} style={styles.reactPillTxt}>
                                  {emoji}{count > 1 ? ` ${count}` : ''}
                                </Text>
                              ))}
                            </View>
                          )}
                        </TouchableOpacity>
                        {m.status === 'error' && (
                          <TouchableOpacity onPress={() => retryMessage(m.tempId, m.content)}>
                            <Ionicons name="alert-circle" size={20} color="#B15A4E" />
                          </TouchableOpacity>
                        )}
                        {isMe && isGroupFooter && m.status === 'read' && (
                          <Ionicons name="checkmark-done" size={14} color="#2C7C96" style={{ marginBottom: 4 }} />
                        )}
                        {isMe && isGroupFooter && m.status === 'sent' && (
                          <Ionicons name="checkmark" size={14} color="rgba(34,39,31,0.4)" style={{ marginBottom: 4 }} />
                        )}
                      </View>
                      )}
                      {!m.deleted_at && m.edited_at && (
                        <Text style={[styles.editedTxt, isMe ? { textAlign: 'right' } : null]}>Edited</Text>
                      )}
                      {isMe && isGroupFooter && m.status === 'sending' && (
                        <Text style={styles.statusTxt}>Sending…</Text>
                      )}
                    </View>
                  </View>
                );
              })
            )}

            {Object.keys(typingUsers).map((uid) => {
              if (!typingUsers[uid] || uid === currentUser?.id) return null;
              const name = orgUsers.find((u) => u.id === uid)?.full_name || 'Someone';
              return (
                <View key={`typing_${uid}`} style={styles.typingContainer}>
                  <Text style={styles.typingText}>{name.split(' ')[0]} is typing…</Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.chatInputRow}>
            <View style={styles.chatInputBox}>
              <TextInput
                style={styles.chatInputReal}
                placeholder="Type a message…"
                placeholderTextColor="rgba(34,39,31,0.4)"
                value={newMessage}
                onChangeText={handleTyping}
                onSubmitEditing={sendMessage}
                returnKeyType="send"
              />
            </View>
            <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
              <Ionicons name="paper-plane" size={18} color="#165B74" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── iMessage action overlay (long-press) ──────────────────────────── */}
      <Modal visible={!!msgAction} transparent animationType="fade">
        <Pressable style={styles.actionScrim} onPress={() => setMsgAction(null)}>
          {msgAction && (
            <Pressable onPress={(e: any) => e.stopPropagation()}>
              {/* tapback bar */}
              <View style={styles.tapbackBar}>
                {TAPBACKS.map((e) => {
                  const mine = (reactions[msgAction.id] ?? []).find((r) => r.user_id === currentUser?.id)?.emoji === e;
                  return (
                    <TouchableOpacity key={e} style={[styles.tapbackBtn, mine && styles.tapbackOn]} onPress={() => toggleReaction(msgAction, e)}>
                      <Text style={styles.tapbackEmoji}>{e}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* message preview */}
              <View style={styles.actionPreview}>
                <View style={msgAction.sender_id === currentUser?.id ? styles.bubbleSent : styles.bubbleRecv}>
                  <Text style={msgAction.sender_id === currentUser?.id ? styles.bubbleTxtSent : styles.bubbleTxt} numberOfLines={6}>
                    {msgAction.content}
                  </Text>
                </View>
              </View>
              {/* actions */}
              <View style={styles.actionList}>
                {canEditMsg(msgAction) && (
                  <TouchableOpacity style={styles.actionRow} onPress={() => { setEditText(msgAction.content); setEditTarget(msgAction); setMsgAction(null); }}>
                    <Text style={styles.actionRowTxt}>Edit</Text>
                    <Ionicons name="pencil-outline" size={18} color="#22271F" />
                  </TouchableOpacity>
                )}
                {msgAction.sender_id === currentUser?.id ? (
                  <TouchableOpacity style={[styles.actionRow, { borderBottomWidth: 0 }]} onPress={() => unsendMessage(msgAction)}>
                    <Text style={[styles.actionRowTxt, { color: '#B15A4E' }]}>Unsend</Text>
                    <Ionicons name="trash-outline" size={18} color="#B15A4E" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.actionRow, { borderBottomWidth: 0 }]} onPress={() => { setShowReport({ msgId: msgAction.id, content: msgAction.content }); setMsgAction(null); }}>
                    <Text style={[styles.actionRowTxt, { color: '#B15A4E' }]}>Report</Text>
                    <Ionicons name="flag-outline" size={18} color="#B15A4E" />
                  </TouchableOpacity>
                )}
              </View>
            </Pressable>
          )}
        </Pressable>
      </Modal>

      {/* ── Edit message sheet ─────────────────────────────────────────────── */}
      <Modal visible={!!editTarget} transparent animationType="fade">
        <Pressable style={styles.actionScrim} onPress={() => setEditTarget(null)}>
          <Pressable onPress={(e: any) => e.stopPropagation()}>
            <View style={[styles.actionList, { minWidth: 300, padding: 18 }]}>
              <Text style={{ fontFamily: 'Inter-Bold', fontSize: 17, color: '#22271F', marginBottom: 12 }}>Edit message</Text>
              <TextInput
                style={{ fontFamily: 'Inter-Regular', fontSize: 15, color: '#22271F', backgroundColor: '#F7F8F8', borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', borderRadius: 12, padding: 12, minHeight: 60, textAlignVertical: 'top' }}
                value={editText}
                onChangeText={setEditText}
                multiline
                autoFocus
              />
              <TouchableOpacity
                onPress={saveEdit}
                disabled={!editText.trim()}
                style={{ backgroundColor: '#165B74', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14, opacity: editText.trim() ? 1 : 0.5 }}
              >
                <Text style={{ fontFamily: 'Inter-Bold', fontSize: 14.5, color: '#F4F6F6' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Report Modal ───────────────────────────────────────────────────── */}
      <Modal visible={!!showReport} transparent animationType="slide">
        <View style={styles.newChatBackdrop}>
          <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFillObject} />
          <Pressable style={{ flex: 1 }} onPress={() => setShowReport(null)} />
          <View style={[styles.newChatSheet, { height: 'auto', paddingBottom: 40 }]}>
            <View style={styles.newChatTop}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Report Message</Text>
                <TouchableOpacity onPress={() => setShowReport(null)} style={styles.closeBtn}>
                  <Ionicons name="close" size={20} color="#22271F" />
                </TouchableOpacity>
              </View>
              <Text style={{ color: 'rgba(34,39,31,0.6)', marginBottom: 20 }}>
                Selecting a reason will notify your organization's admins.
              </Text>
              {['Inappropriate Language', 'Bullying or Harassment', 'Personal Info Sharing', 'Spam'].map((reason) => (
                <TouchableOpacity
                  key={reason}
                  style={styles.memberSelectRow}
                  onPress={() => submitReport(showReport!.msgId, reason)}
                >
                  <Text style={{ color: '#22271F', fontSize: 16 }}>{reason}</Text>
                  <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.3)" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { paddingTop: 72, paddingBottom: 16, paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  pageTitle: { fontFamily: 'Inter-Black', fontSize: 34, color: '#22271F', letterSpacing: -1 },
  pageSubtitle: { fontFamily: 'Inter-Regular', fontSize: 14, color: 'rgba(34,39,31,0.45)', marginTop: 3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(196,196,196,0.16)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)', borderRadius: 20, overflow: 'hidden' },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerDivider: { width: 1, height: 22, backgroundColor: 'rgba(196,196,196,0.32)' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 140 },
  sectionLabel: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: 'rgba(34,39,31,0.3)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginTop: 4 },
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(44,124,150,0.12)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', alignItems: 'center', justifyContent: 'center', marginRight: 14, position: 'relative' },
  avatarText: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#2C7C96' },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.base },
  memberName: { fontFamily: 'Inter-SemiBold', fontSize: 16, color: '#22271F' },
  memberTime: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.35)' },
  memberRole: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.45)', textTransform: 'capitalize', marginTop: 2 },
  emptyTitle: { fontFamily: 'Inter-SemiBold', fontSize: 16, color: '#22271F', marginTop: 12 },
  emptySubtitle: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.4)', textAlign: 'center', marginTop: 4 },

  // New chat sheet
  newChatBackdrop: { flex: 1, justifyContent: 'flex-end' },
  newChatSheet: { height: '85%', overflow: 'hidden', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: 'rgba(196,196,196,0.32)', backgroundColor: '#FFFFFF' },
  newChatTop: { padding: 20, paddingTop: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.16)', zIndex: 10 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(196,196,196,0.25)', alignSelf: 'center', marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sheetTitle: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#22271F' },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(196,196,196,0.22)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)', alignItems: 'center', justifyContent: 'center' },

  // Tab toggle
  tabToggle: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', backgroundColor: 'rgba(196,196,196,0.06)' },
  tabBtnActive: { borderColor: 'rgba(196,196,196,0.4)', backgroundColor: 'rgba(196,196,196,0.14)' },
  tabLabel: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: 'rgba(34,39,31,0.4)' },
  tabLabelActive: { color: '#22271F' },

  groupNameInput: { backgroundColor: 'rgba(196,196,196,0.1)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(196,196,196,0.2)', paddingHorizontal: 16, paddingVertical: 12, fontFamily: 'Inter-Regular', fontSize: 15, color: '#22271F', marginBottom: 12 },

  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(196,196,196,0.16)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  searchInput: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 15, color: '#22271F' },
  memberSelectRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.16)' },
  checkCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(196,196,196,0.3)', alignItems: 'center', justifyContent: 'center' },
  checkCircleSel: { backgroundColor: '#2C7C96', borderColor: '#2C7C96' },

  createGroupFooter: { padding: 20, paddingBottom: 40, borderTopWidth: 1, borderTopColor: 'rgba(196,196,196,0.16)', gap: 10, zIndex: 10 },
  createGroupCount: { fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(34,39,31,0.5)', textAlign: 'center' },
  createGroupBtn: { backgroundColor: colors.platinum, paddingVertical: 16, borderRadius: 18, alignItems: 'center' },
  createGroupBtnDisabled: { opacity: 0.35 },
  createGroupBtnTxt: { fontFamily: 'Inter-Bold', fontSize: 16, color: colors.base },

  // Chat thread
  chatHeader: { paddingTop: 24, paddingBottom: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.16)' },
  chatAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(44,124,150,0.15)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  chatName: { fontFamily: 'Inter-SemiBold', fontSize: 16, color: '#22271F' },
  onlineTxt: { fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(34,39,31,0.4)', marginTop: 2, textTransform: 'capitalize' },
  dateChip: { alignSelf: 'center', backgroundColor: 'rgba(196,196,196,0.16)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 8 },
  dateChipTxt: { fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(34,39,31,0.4)' },
  bubbleSentWrap: { alignSelf: 'flex-end', maxWidth: '78%' },
  bubbleRecvWrap: { alignSelf: 'flex-start', maxWidth: '78%' },
  bubbleRecv: { backgroundColor: '#F7F8F8', borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 18, borderBottomLeftRadius: 5, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleSent: { backgroundColor: '#165B74', borderRadius: 18, borderBottomRightRadius: 5, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleTxt: { fontFamily: 'Inter-Regular', fontSize: 15, color: '#22271F', lineHeight: 21 },
  bubbleTxtSent: { fontFamily: 'Inter-Regular', fontSize: 15, color: '#F4F6F6', lineHeight: 21 },
  unsentTxt: { fontFamily: 'Inter-Regular', fontSize: 13, fontStyle: 'italic', color: 'rgba(34,39,31,0.4)', paddingVertical: 8, paddingHorizontal: 4 },
  editedTxt: { fontFamily: 'Inter-Regular', fontSize: 10.5, color: 'rgba(34,39,31,0.4)', marginTop: 2, marginHorizontal: 6 },
  reactPill: { position: 'absolute', top: -14, flexDirection: 'row', gap: 3, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(196,196,196,0.18)', borderRadius: 14, paddingHorizontal: 7, paddingVertical: 3, shadowColor: '#2B3325', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4, elevation: 3 },
  reactPillTxt: { fontSize: 12 },
  // iMessage action overlay
  actionScrim: { flex: 1, backgroundColor: 'rgba(30,36,28,0.4)', justifyContent: 'center', paddingHorizontal: 28 },
  tapbackBar: { flexDirection: 'row', alignSelf: 'center', gap: 4, backgroundColor: '#FFFFFF', borderRadius: 26, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', paddingHorizontal: 10, paddingVertical: 8, marginBottom: 12 },
  tapbackBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tapbackOn: { backgroundColor: 'rgba(44,124,150,0.16)' },
  tapbackEmoji: { fontSize: 21 },
  actionPreview: { alignSelf: 'center', maxWidth: '84%', marginBottom: 14 },
  actionList: { alignSelf: 'center', minWidth: 220, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', overflow: 'hidden' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.08)' },
  actionRowTxt: { fontFamily: 'Inter-Medium', fontSize: 15.5, color: '#22271F' },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 32, borderTopWidth: 1, borderTopColor: 'rgba(196,196,196,0.16)', gap: 10 },
  chatInputBox: { flex: 1, height: 48, borderRadius: 24, backgroundColor: 'rgba(196,196,196,0.16)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)', paddingHorizontal: 18, justifyContent: 'center' },
  chatInputReal: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 15, color: '#22271F' },
  sendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(44,124,150,0.35)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.5)', alignItems: 'center', justifyContent: 'center' },

  // Settings
  settingsBackdrop: { flex: 1, justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 110, paddingRight: 20 },
  settingsMenu: { width: 220, borderRadius: 20, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 10 },
  settingsItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, gap: 12 },
  settingsItemTxt: { fontFamily: 'Inter-Medium', fontSize: 14, color: '#22271F' },
  settingsDivider: { height: 1, backgroundColor: 'rgba(196,196,196,0.16)', marginHorizontal: 12 },

  // Message
  dateDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 10, paddingHorizontal: 10 },
  divideLine: { flex: 1, height: 1, backgroundColor: 'rgba(196,196,196,0.16)' },
  divideText: { fontFamily: 'Inter-Medium', fontSize: 11, color: 'rgba(34,39,31,0.3)', textTransform: 'uppercase', letterSpacing: 1 },
  senderNameTxt: { fontSize: 11, fontFamily: 'Inter-Bold', color: '#2C7C96', marginLeft: 14, marginBottom: 4, opacity: 0.8 },
  statusTxt: { fontSize: 10, fontFamily: 'Inter-Regular', color: 'rgba(34,39,31,0.3)', marginLeft: 12, marginTop: 2 },
  typingContainer: { paddingLeft: 12, paddingVertical: 8, height: 30 },
  typingText: { fontFamily: 'Inter-Medium', fontSize: 11, color: 'rgba(34,39,31,0.4)', fontStyle: 'italic' },
});
