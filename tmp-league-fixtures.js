const { createClient } = require('@supabase/supabase-js');
const { getLeagueFixturesBySeason } = require('./lib/queries/fixtures');
const env = require('fs').readFileSync('.env.local','utf8').split(/\r?\n/).reduce((acc,line)=>{const idx=line.indexOf('=');if(idx===-1)return acc;const key=line.slice(0,idx).trim();const value=line.slice(idx+1).trim();if(!key)return acc;acc[key]=value;return acc;},{});
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
getLeagueFixturesBySeason(39, 2025).then(data => {
  console.log('count',data.length);
  console.log(data[0]);
});
