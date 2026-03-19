#!/bin/bash
set -e
CACHE_DIR="/opt/diva-embedded/assets/cached-responses"
TTS_URL="http://localhost:8880/synthesize"

generate() {
  local text="$1"
  local output="$2"
  mkdir -p "$CACHE_DIR/$(dirname "$output")"
  curl -s -X POST "$TTS_URL" -H "Content-Type: application/json" -d "{\"text\": \"$text\"}" --output "$CACHE_DIR/$output"
  echo "  ✅ $output"
}

echo "=== Génération des fillers Diva ==="

# SEARCH
echo "📡 Search fillers..."
generate "Je regarde ça tout de suite." "search-fillers/01.wav"
generate "Attends, je fais une petite recherche." "search-fillers/02.wav"
generate "Deux secondes, je vérifie." "search-fillers/03.wav"
generate "Je cherche ça pour toi." "search-fillers/04.wav"
generate "Hmm, bonne question. Je regarde." "search-fillers/05.wav"
generate "Laisse-moi vérifier." "search-fillers/06.wav"
generate "Je jette un œil, une seconde." "search-fillers/07.wav"
generate "OK, je cherche." "search-fillers/08.wav"

# THINKING
echo "🧠 Thinking fillers..."
generate "Hmm, laisse-moi réfléchir." "thinking-fillers/01.wav"
generate "Bonne question, attends." "thinking-fillers/02.wav"
generate "Je réfléchis deux secondes." "thinking-fillers/03.wav"
generate "Alors voyons..." "thinking-fillers/04.wav"
generate "OK, je pense à ça." "thinking-fillers/05.wav"
generate "Hmm, intéressant. Attends." "thinking-fillers/06.wav"

# RECIPE
echo "🍳 Recipe fillers..."
generate "Miam, je te trouve ça." "recipe-fillers/01.wav"
generate "Bonne idée ! Je cherche la recette." "recipe-fillers/02.wav"
generate "Attends, je regarde comment on fait ça." "recipe-fillers/03.wav"
generate "Oh, tu me donnes faim. Je cherche." "recipe-fillers/04.wav"
generate "OK chef, je te trouve ça." "recipe-fillers/05.wav"
generate "Je regarde la recette, deux secondes." "recipe-fillers/06.wav"

# NEWS
echo "📰 News fillers..."
generate "Je regarde les dernières infos." "news-fillers/01.wav"
generate "Attends, je check les actus." "news-fillers/02.wav"
generate "Voyons ce qui se passe dans le monde." "news-fillers/03.wav"
generate "Je fais le tour de l'actu pour toi." "news-fillers/04.wav"
generate "Deux secondes, je rassemble les infos." "news-fillers/05.wav"

# WEATHER
echo "🌤️ Weather fillers..."
generate "Je regarde la météo." "weather-fillers/01.wav"
generate "Attends, je check le temps qu'il fait." "weather-fillers/02.wav"
generate "Deux secondes, je regarde dehors pour toi." "weather-fillers/03.wav"
generate "Je vérifie la météo, un instant." "weather-fillers/04.wav"

# KNOWLEDGE
echo "📚 Knowledge fillers..."
generate "Bonne question, je vérifie." "knowledge-fillers/01.wav"
generate "Attends, je regarde ça." "knowledge-fillers/02.wav"
generate "Hmm, laisse-moi chercher." "knowledge-fillers/03.wav"
generate "Je me renseigne, deux secondes." "knowledge-fillers/04.wav"
generate "Intéressant, je regarde." "knowledge-fillers/05.wav"

# ADVICE
echo "💡 Advice fillers..."
generate "Laisse-moi réfléchir à ça." "advice-fillers/01.wav"
generate "OK, je te prépare quelques idées." "advice-fillers/02.wav"
generate "Hmm, voyons ce qu'on peut faire." "advice-fillers/03.wav"
generate "Bonne question, deux secondes." "advice-fillers/04.wav"
generate "Je réfléchis au meilleur conseil." "advice-fillers/05.wav"

# TRANSLATION
echo "🌍 Translation fillers..."
generate "Attends, je traduis." "translation-fillers/01.wav"
generate "Je cherche la traduction." "translation-fillers/02.wav"
generate "Deux secondes, je regarde comment on dit ça." "translation-fillers/03.wav"

# CALC
echo "🔢 Calc fillers..."
generate "Je calcule..." "calc-fillers/01.wav"
generate "Attends, je fais le calcul." "calc-fillers/02.wav"
generate "Deux secondes, je compte." "calc-fillers/03.wav"

# BABY
echo "👶 Baby fillers..."
generate "Je regarde les dernières infos sur Jean." "baby-fillers/01.wav"
generate "Attends, je vérifie." "baby-fillers/02.wav"
generate "Je consulte le suivi, deux secondes." "baby-fillers/03.wav"

# HOME
echo "🏠 Home fillers..."
generate "C'est parti." "home-fillers/01.wav"
generate "Je m'en occupe." "home-fillers/02.wav"
generate "OK, deux secondes." "home-fillers/03.wav"

# MEDIA
echo "🎵 Media fillers..."
generate "Je cherche ça dans ta bibliothèque." "media-fillers/01.wav"
generate "Attends, je regarde ce qu'on a." "media-fillers/02.wav"
generate "OK, je te mets ça." "media-fillers/03.wav"

# MICRO
echo "🔊 Micro fillers..."
generate "Hmm..." "micro-fillers/hmm.wav"

# WAIT
echo "⏳ Wait fillers..."
generate "Encore une petite seconde." "wait-fillers/01.wav"
generate "C'est un peu long, j'y suis presque." "wait-fillers/02.wav"
generate "Patience, ça arrive." "wait-fillers/03.wav"
generate "Presque, attends." "wait-fillers/04.wav"

echo "=== Terminé ==="
find "$CACHE_DIR" -name "*.wav" | wc -l
