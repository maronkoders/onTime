const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl = process.env.DATABASE_URL.replace('postgresql://', 'https://').replace(':5432/postgres', '.supabase.co');
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

const supabase = createClient(supabaseUrl, supabaseKey);

const SESSION_TTL = 1800; // 30 minutes in seconds

async function getSession(phone) {
  try {
    const { data, error } = await supabase
      .from('user_sessions')
      .select('session_data')
      .eq('phone', phone)
      .gte('expires_at', new Date().toISOString())
      .single();

    if (error || !data) return null;
    return data.session_data;
  } catch (err) {
    logger.error(`Failed to get session for ${phone}: ${err.message}`);
    return null;
  }
}

async function setSession(phone, session) {
  try {
    const expiresAt = new Date(Date.now() + SESSION_TTL * 1000).toISOString();
    
    const { error } = await supabase
      .from('user_sessions')
      .upsert({
        phone,
        session_data: session,
        expires_at: expiresAt,
      }, {
        onConflict: 'phone'
      });

    if (error) throw error;
  } catch (err) {
    logger.error(`Failed to set session for ${phone}: ${err.message}`);
  }
}

async function updateSession(phone, updates) {
  const session = (await getSession(phone)) || {};
  const merged = { ...session, ...updates };
  if (updates.context) {
    merged.context = { ...(session.context || {}), ...updates.context };
  }
  await setSession(phone, merged);
  return merged;
}

async function clearSession(phone) {
  try {
    const { error } = await supabase
      .from('user_sessions')
      .delete()
      .eq('phone', phone);

    if (error) throw error;
  } catch (err) {
    logger.error(`Failed to clear session for ${phone}: ${err.message}`);
  }
}

module.exports = {
  getSession,
  setSession,
  updateSession,
  clearSession,
};
