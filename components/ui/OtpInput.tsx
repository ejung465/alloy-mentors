import React, { useRef, useState } from 'react';
import { View, TextInput, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { colors, font, radius } from '@/lib/theme';

interface OtpInputProps {
  value: string;
  onChange: (v: string) => void;
  /** Number of digit cells. Defaults to 6. */
  length?: number;
  autoFocus?: boolean;
}

/**
 * Six-digit code entry rendered as individual boxed cells, backed by a single
 * invisible TextInput that captures real input (including iOS/Android OTP
 * autofill suggestions). The boxes are purely visual — driven off the hidden
 * input's value string — so backspace/auto-advance/paste all fall out of
 * normal TextInput behavior for free.
 */
export function OtpInput({ value, onChange, length = 6, autoFocus }: OtpInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const digits = Array.from({ length }, (_, i) => value[i] ?? '');
  const cursorIndex = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => inputRef.current?.focus()} style={styles.wrap}>
      <View style={styles.boxRow}>
        {digits.map((d, i) => {
          const isCursor = focused && i === cursorIndex && value.length < length;
          return (
            <View key={i} style={[styles.box, (isCursor || (focused && d)) && styles.boxFocused]}>
              <Text style={styles.digit}>{d}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        caretHidden
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', alignItems: 'center' },
  boxRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  box: {
    width: 46,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFocused: {
    borderColor: colors.platinum,
  },
  digit: {
    fontFamily: font.bold,
    fontSize: 24,
    color: colors.text,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
});
