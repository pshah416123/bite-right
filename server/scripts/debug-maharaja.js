require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const axios = require('axios');
const { extractMenuFromUrl, assignMenuGroups, scoreMenu, detectProvider } = require('../menuExtractors');

(async () => {
  const find = await axios.get('https://maps.googleapis.com/maps/api/place/findplacefromtext/json', {
    params: { input: 'Maharaja Grill, Chicago', inputtype: 'textquery', fields: 'place_id,name,formatted_address', key: process.env.GOOGLE_PLACES_API_KEY },
  });
  const candidate = find.data?.candidates?.[0];
  console.log('place:', candidate?.name, '|', candidate?.formatted_address);
  console.log('place_id:', candidate?.place_id);
  if (!candidate?.place_id) return;

  const details = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
    params: { place_id: candidate.place_id, key: process.env.GOOGLE_PLACES_API_KEY, fields: 'name,website,url' },
  });
  const website = details.data?.result?.website;
  console.log('website:', website);

  if (!website) {
    console.log('no website on place; pipeline would fall to photos/LLM');
    return;
  }

  console.log('\nRunning extractMenuFromUrl...');
  const t0 = Date.now();
  const result = await extractMenuFromUrl(website);
  console.log('elapsed:', Date.now() - t0, 'ms');
  if (!result) {
    console.log('result: null');
    return;
  }
  const tagged = assignMenuGroups(result.sections);
  const totalItems = tagged.reduce((n, s) => n + s.items.length, 0);
  const { score } = scoreMenu(tagged);
  console.log('source:', result.source, '| pdfUrl:', result.pdfUrl || '-');
  console.log('sections:', tagged.length, '| items:', totalItems, '| score:', score);
  console.log('');
  for (const s of tagged.slice(0, 10)) {
    console.log('[' + s.title + ']', '(' + s.group + ',', s.items.length + ')');
    for (const it of s.items.slice(0, 5)) console.log('  -', it.name, it.price || '');
  }
})().catch((e) => { console.error(e?.message || e); process.exit(1); });
