import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, radius } from './theme';

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet';
  compact?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
  compact = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        ui.button,
        ui[`button_${variant}`],
        compact && ui.buttonCompact,
        style,
        pressed && ui.pressed,
        isDisabled && ui.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.black : colors.text}
          size="small"
        />
      ) : (
        <Text
          style={[
            ui.buttonText,
            variant === 'primary' && ui.buttonTextPrimary,
            variant === 'danger' && ui.buttonTextDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
}

export function Field({ label, hint, error, style, ...props }: FieldProps) {
  return (
    <View style={ui.field}>
      {label ? <Text style={ui.fieldLabel}>{label}</Text> : null}
      <TextInput
        {...props}
        accessibilityHint={props.accessibilityHint ?? error ?? hint}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={colors.textSubtle}
        selectionColor={colors.primary}
        style={[ui.input, props.multiline && ui.inputMultiline, style]}
      />
      {error ? <Text style={ui.errorText}>{error}</Text> : null}
      {!error && hint ? <Text style={ui.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Avatar({
  name,
  uri,
  size = 48,
}: {
  name: string | null;
  uri?: string | null;
  size?: number;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [uri]);
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (uri && !imageFailed) {
    return (
      <Image
        accessible={false}
        accessibilityIgnoresInvertColors
        onError={() => setImageFailed(true)}
        source={{ uri }}
        style={style}
      />
    );
  }

  return (
    <View style={[ui.avatar, style]}>
      <Text style={[ui.avatarText, { fontSize: Math.max(13, size * 0.34) }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

export function Notice({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'error' | 'success';
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[ui.notice, tone === 'error' && ui.noticeError]}
    >
      <Text
        style={[
          ui.noticeText,
          tone === 'error' && ui.noticeTextError,
          tone === 'success' && ui.noticeTextSuccess,
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={ui.emptyState}>
      <View style={ui.emptyGlyph}>
        <Text style={ui.emptyGlyphText}>C</Text>
      </View>
      <Text style={ui.emptyTitle}>{title}</Text>
      <Text style={ui.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

export function LoadingScreen({ label = 'Opening Chateo…' }: { label?: string }) {
  return (
    <View style={ui.loadingScreen}>
      <View style={ui.brandMark}>
        <Text style={ui.brandMarkText}>C</Text>
      </View>
      <ActivityIndicator color={colors.primary} size="small" />
      <Text style={ui.loadingText}>{label}</Text>
    </View>
  );
}

export function ConnectionPill({
  status,
}: {
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
}) {
  const active = status === 'connected';
  return (
    <View style={ui.connectionPill}>
      <View
        style={[
          ui.connectionDot,
          { backgroundColor: active ? colors.success : colors.warning },
        ]}
      />
      <Text style={ui.connectionText}>{status}</Text>
    </View>
  );
}

function initials(name: string | null): string {
  const clean = name?.trim();
  if (!clean) return '?';
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export const ui = StyleSheet.create({
  flex: { flex: 1 },
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    padding: 24,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 23,
    height: 64,
    justifyContent: 'center',
    marginBottom: 8,
    transform: [{ rotate: '-5deg' }],
    width: 64,
  },
  brandMarkText: {
    color: colors.black,
    fontSize: 32,
    fontWeight: '900',
  },
  loadingText: { color: colors.textMuted, fontSize: 14 },
  button: {
    alignItems: 'center',
    borderRadius: radius.medium,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  buttonCompact: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 9 },
  button_primary: { backgroundColor: colors.primary },
  button_secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
    borderWidth: 1,
  },
  button_quiet: { backgroundColor: colors.primaryDim },
  button_danger: {
    backgroundColor: '#2B1720',
    borderColor: '#5D2A39',
    borderWidth: 1,
  },
  buttonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  buttonTextPrimary: { color: colors.black },
  buttonTextDanger: { color: colors.danger },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.42 },
  field: { gap: 7 },
  fieldLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  input: {
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  inputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  hint: { color: colors.textSubtle, fontSize: 12, lineHeight: 17 },
  errorText: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primaryDim,
    borderColor: '#3C4D89',
    borderWidth: 1,
    justifyContent: 'center',
  },
  avatarText: { color: '#BDC7FF', fontWeight: '900' },
  notice: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.small,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  noticeError: { backgroundColor: '#211219', borderColor: '#542837' },
  noticeText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  noticeTextError: { color: '#FFABB5' },
  noticeTextSuccess: { color: '#8DEBC5' },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingVertical: 56,
  },
  emptyGlyph: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 27,
    borderWidth: 1,
    height: 72,
    justifyContent: 'center',
    marginBottom: 20,
    width: 72,
  },
  emptyGlyphText: { color: colors.primary, fontSize: 28, fontWeight: '900' },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 20,
    maxWidth: 300,
    textAlign: 'center',
  },
  connectionPill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  connectionDot: { borderRadius: 5, height: 7, width: 7 },
  connectionText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
});
