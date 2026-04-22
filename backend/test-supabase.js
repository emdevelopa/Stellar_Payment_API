import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

async function testSupabase() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('Connecting to Supabase API...');
  console.log('URL:', process.env.SUPABASE_URL);

  try {
    const { data, error } = await supabase.from('merchants').select('id').limit(1);
    
    if (error) {
      console.error('Supabase error:', error.message);
      console.error('Full error:', error);
    } else {
      console.log('Connected successfully! Data:', data);
    }
  } catch (err) {
    console.error('Catch error:', err.message);
  }
}

testSupabase();
