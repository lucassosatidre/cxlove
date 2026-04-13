import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

const EMOJI_OPTIONS = [
  '👤','👨‍🍳','🏍️','🔥','⭐','🎯','💼','🍕','🚀','💪',
  '🎉','😎','🤙','👑','🦸‍♂️','🧑‍💻','🏆','🎸','🌟','💡',
  '🔧','📊','🎯','🍕','🏄‍♂️','⚡','🎮','🎪','🦅','🐺',
];

export function useAvatarEmoji() {
  const { user } = useAuth();
  const [emoji, setEmoji] = useState('👤');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    supabase
      .from('user_preferences' as any)
      .select('avatar_emoji')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data && (data as any).avatar_emoji) setEmoji((data as any).avatar_emoji);
        setLoading(false);
      });
  }, [user]);

  const updateEmoji = async (newEmoji: string) => {
    if (!user) return;
    setEmoji(newEmoji);

    const { data: existing } = await supabase
      .from('user_preferences' as any)
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      await (supabase.from('user_preferences' as any) as any)
        .update({ avatar_emoji: newEmoji, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    } else {
      await (supabase.from('user_preferences' as any) as any)
        .insert({ user_id: user.id, avatar_emoji: newEmoji });
    }
  };

  return { emoji, updateEmoji, loading, EMOJI_OPTIONS };
}
