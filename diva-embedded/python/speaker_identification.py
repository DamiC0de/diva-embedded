#!/usr/bin/env python3
"""
Identification vocale simple pour Diva Embedded.
Utilise des caractéristiques audio basiques (MFCC) pour identifier le locuteur.
"""

import os
import json
import numpy as np
import librosa
from sklearn.metrics.pairwise import cosine_similarity
import pickle
import hashlib
from typing import Dict, Optional, List

class SpeakerIdentifier:
    def __init__(self, data_path: str = "/opt/diva-embedded/data/speakers"):
        self.data_path = data_path
        self.speakers_db = {}
        self.load_speakers_db()
    
    def extract_features(self, audio_data: np.ndarray, sr: int = 16000) -> np.ndarray:
        """Extrait des caractéristiques MFCC de l'audio."""
        try:
            # Normaliser l'audio
            if len(audio_data) == 0:
                return np.zeros(13)  # MFCC par défaut
            
            audio_norm = librosa.util.normalize(audio_data)
            
            # Extraire les MFCCs
            mfccs = librosa.feature.mfcc(y=audio_norm, sr=sr, n_mfcc=13)
            # Prendre la moyenne sur le temps
            features = np.mean(mfccs, axis=1)
            
            return features
        except Exception as e:
            print(f"[Speaker] Erreur extraction features: {e}")
            return np.zeros(13)
    
    def register_speaker(self, name: str, audio_samples: List[np.ndarray], sr: int = 16000) -> bool:
        """Enregistre un nouveau locuteur avec plusieurs échantillons."""
        try:
            features_list = []
            for audio in audio_samples:
                features = self.extract_features(audio, sr)
                features_list.append(features)
            
            if not features_list:
                return False
            
            # Moyenner les features de tous les échantillons
            avg_features = np.mean(features_list, axis=0)
            
            # Sauvegarder dans la base
            self.speakers_db[name] = avg_features.tolist()
            self.save_speakers_db()
            
            print(f"[Speaker] Enregistré '{name}' avec {len(features_list)} échantillons")
            return True
            
        except Exception as e:
            print(f"[Speaker] Erreur enregistrement '{name}': {e}")
            return False
    
    def identify_speaker(self, audio_data: np.ndarray, sr: int = 16000, threshold: float = 0.7) -> Optional[str]:
        """Identifie le locuteur dans l'audio donné."""
        if not self.speakers_db:
            return None
        
        try:
            features = self.extract_features(audio_data, sr)
            best_match = None
            best_score = threshold
            
            for name, stored_features in self.speakers_db.items():
                # Calculer la similarité cosinus
                similarity = cosine_similarity([features], [stored_features])[0][0]
                
                if similarity > best_score:
                    best_score = similarity
                    best_match = name
            
            if best_match:
                print(f"[Speaker] Identifié '{best_match}' (score: {best_score:.3f})")
                return best_match
            else:
                print(f"[Speaker] Aucun locuteur identifié (meilleur score: {best_score:.3f})")
                return None
                
        except Exception as e:
            print(f"[Speaker] Erreur identification: {e}")
            return None
    
    def load_speakers_db(self):
        """Charge la base de données des locuteurs."""
        db_file = os.path.join(self.data_path, "speakers.json")
        try:
            if os.path.exists(db_file):
                with open(db_file, 'r') as f:
                    self.speakers_db = json.load(f)
                print(f"[Speaker] Chargé {len(self.speakers_db)} locuteurs depuis {db_file}")
            else:
                print(f"[Speaker] Aucune base de locuteurs trouvée, création nouvelle")
                os.makedirs(self.data_path, exist_ok=True)
        except Exception as e:
            print(f"[Speaker] Erreur chargement DB: {e}")
            self.speakers_db = {}
    
    def save_speakers_db(self):
        """Sauvegarde la base de données des locuteurs."""
        db_file = os.path.join(self.data_path, "speakers.json")
        try:
            with open(db_file, 'w') as f:
                json.dump(self.speakers_db, f, indent=2)
            print(f"[Speaker] DB sauvegardée dans {db_file}")
        except Exception as e:
            print(f"[Speaker] Erreur sauvegarde DB: {e}")
    
    def list_speakers(self) -> List[str]:
        """Retourne la liste des locuteurs enregistrés."""
        return list(self.speakers_db.keys())
    
    def remove_speaker(self, name: str) -> bool:
        """Supprime un locuteur de la base."""
        if name in self.speakers_db:
            del self.speakers_db[name]
            self.save_speakers_db()
            print(f"[Speaker] Supprimé '{name}'")
            return True
        return False

if __name__ == "__main__":
    # Test de base
    identifier = SpeakerIdentifier()
    print(f"Locuteurs enregistrés: {identifier.list_speakers()}")
