const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const supabaseConfigured = !!(supabaseUrl && supabaseServiceKey);

if (!supabaseConfigured) {
  console.warn(
    '[BiteRight] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Using in-memory storage only.',
  );
}

const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

module.exports = { supabase, supabaseConfigured };
