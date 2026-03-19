/**
 * Unified Music Tool for Claude — handles YouTube Music + Spotify + Radio
 *
 * Claude calls play_music with an action and query.
 * The tool routes to the right backend based on context:
 * - Spotify if authenticated and has active device
 * - YouTube Music (yt-dlp) as default/fallback
 * - Radio for radio stations
 */

import * as youtube from "./youtube-player.js";
import * as spotify from "./spotify-player.js";
import { playRadio, stopRadio, setVolume, isPlaying as isRadioPlaying } from "../tools/radio.js";

export async function handleMusicTool(input: Record<string, string>): Promise<string> {
  const action = (input.action || "play").toLowerCase();
  const query = input.query || "";

  switch (action) {
    case "play":
      return handlePlay(query);

    case "stop":
    case "arrête":
    case "arreter":
      return handleStop();

    case "pause":
      return handlePause();

    case "next":
    case "suivant":
      return handleNext();

    case "previous":
    case "précédent":
      return handlePrevious();

    case "volume":
      return setVolume(query);

    case "queue":
    case "ajouter":
      return handleQueue(query);

    case "playing":
    case "en_cours":
      return handleCurrentlyPlaying();

    default:
      // Treat unknown action as a play query
      return handlePlay(action + " " + query);
  }
}

async function handlePlay(query: string): Promise<string> {
  if (!query) return "Dis-moi ce que tu veux écouter.";

  const lower = query.toLowerCase();

  // Radio detection
  if (/\b(radio|france inter|france info|france culture|france musique|fip|rtl|rmc|nostalgie|cherie|nrj)\b/i.test(lower)) {
    return playRadio(query);
  }

  // Try Spotify first if authenticated
  if (spotify.isAuthenticated()) {
    try {
      const result = await spotify.play(query);
      if (result === "no_device") {
        // No Spotify device — fallback to YouTube
        console.log("[MUSIC] No Spotify device, falling back to YouTube");
      } else if (result === "not_found") {
        // Not found on Spotify — try YouTube
        console.log("[MUSIC] Not found on Spotify, trying YouTube");
      } else if (result !== "error") {
        return `Je lance ${result} sur Spotify.`;
      }
    } catch {
      console.log("[MUSIC] Spotify error, falling back to YouTube");
    }
  }

  // YouTube Music (default / fallback)
  const trackInfo = await youtube.searchAndPlay(query);
  if (trackInfo) {
    return `Je lance ${trackInfo}.`;
  }

  return "Je n'ai pas trouvé cette musique.";
}

function handleStop(): string {
  // Stop everything
  if (youtube.isPlaying()) {
    youtube.stop();
    youtube.clearQueue();
    return "Musique arrêtée.";
  }
  if (isRadioPlaying()) {
    return stopRadio();
  }
  if (spotify.isAuthenticated()) {
    spotify.pausePlayback().catch(() => {});
    return "Musique arrêtée.";
  }
  return "Rien ne joue en ce moment.";
}

function handlePause(): string {
  if (youtube.isPlaying()) {
    youtube.pause();
    return "Musique en pause.";
  }
  if (spotify.isAuthenticated()) {
    spotify.pausePlayback().catch(() => {});
    return "Musique en pause.";
  }
  return "Rien ne joue en ce moment.";
}

async function handleNext(): Promise<string> {
  if (spotify.isAuthenticated()) {
    await spotify.nextTrack();
    return "Morceau suivant.";
  }
  // YouTube: stop current, play next in queue
  youtube.stop();
  return "Morceau suivant.";
}

async function handlePrevious(): Promise<string> {
  if (spotify.isAuthenticated()) {
    await spotify.previousTrack();
    return "Morceau précédent.";
  }
  return "Pas de morceau précédent disponible.";
}

async function handleQueue(query: string): Promise<string> {
  if (!query) return "Dis-moi quelle musique ajouter.";
  const result = await youtube.addToQueue(query);
  return result || "Je n'ai pas trouvé cette musique.";
}

async function handleCurrentlyPlaying(): Promise<string> {
  // Check YouTube first
  const ytTrack = youtube.getCurrentTrack();
  if (ytTrack) {
    return `En cours : ${ytTrack.title}${ytTrack.artist ? ` de ${ytTrack.artist}` : ""}.`;
  }

  // Check Spotify
  if (spotify.isAuthenticated()) {
    const spTrack = await spotify.getCurrentlyPlaying();
    if (spTrack) {
      return `En cours sur Spotify : ${spTrack.name} de ${spTrack.artist}.`;
    }
  }

  if (isRadioPlaying()) {
    return "La radio est en cours.";
  }

  return "Rien ne joue en ce moment.";
}
