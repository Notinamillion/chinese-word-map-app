// Script to fetch example sentences from Tatoeba API for all characters
// Run this on Synology NAS or locally to populate sentences database

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load characters.json
const charactersPath = path.join(__dirname, '../src/data/characters.json');
const characters = require(charactersPath);

// Tatoeba API endpoint
const TATOEBA_API = 'https://tatoeba.org/en/api_v0/search';

// Sleep function to avoid rate limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch sentences for a character
async function fetchSentences(char) {
  return new Promise((resolve, reject) => {
    const url = `${TATOEBA_API}?query=${encodeURIComponent(char)}&from=cmn&to=eng&limit=10`;

    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
}

// Main function
async function main() {
  const sentencesData = {};
  const chars = Object.keys(characters);

  console.log(`Fetching sentences for ${chars.length} characters...`);

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const charInfo = characters[char];

    console.log(`[${i + 1}/${chars.length}] Fetching sentences for ${char} (${charInfo.pinyin})...`);

    try {
      const result = await fetchSentences(char);

      if (result.results && result.results.length > 0) {
        // Process sentences
        const sentences = result.results.map(item => {
          const chinese = item.text;
          const english = item.translations && item.translations[0] && item.translations[0][0]
            ? item.translations[0][0].text
            : '';

          // Try to extract pinyin if available (Tatoeba sometimes has it)
          const pinyin = item.transcriptions && item.transcriptions.cmn && item.transcriptions.cmn[0]
            ? item.transcriptions.cmn[0].text
            : '';

          return {
            chinese,
            pinyin: pinyin || '',
            english,
            difficulty: 1 // Default difficulty
          };
        }).filter(s => s.english); // Only keep sentences with translations

        if (sentences.length > 0) {
          sentencesData[char] = {
            character: char,
            pinyin: charInfo.pinyin,
            meanings: charInfo.meanings,
            sentences: sentences
          };

          console.log(`  ✓ Found ${sentences.length} sentences`);
        } else {
          console.log(`  ✗ No sentences with translations found`);
        }
      } else {
        console.log(`  ✗ No results from Tatoeba`);
      }

      // Rate limiting: wait 1 second between requests
      await sleep(1000);
    } catch (error) {
      console.error(`  ✗ Error fetching sentences for ${char}:`, error.message);
    }
  }

  // Save to file
  const outputPath = path.join(__dirname, 'tatoeba-sentences.json');
  fs.writeFileSync(outputPath, JSON.stringify(sentencesData, null, 2), 'utf-8');

  console.log(`\n✓ Done! Saved ${Object.keys(sentencesData).length} characters with sentences to ${outputPath}`);
  console.log(`\nNext steps:`);
  console.log(`1. Upload tatoeba-sentences.json to Synology: /volume1/web/chinese-word-map/data/`);
  console.log(`2. Apply the add-sentence-practice.patch to server-synology.js`);
  console.log(`3. Restart the server`);
}

main().catch(console.error);
