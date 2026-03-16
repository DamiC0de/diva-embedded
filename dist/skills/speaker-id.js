/**
 * Speaker Identification Skill pour Diva
 * Gère l'identification des locuteurs et la personnalisation des réponses
 */

const Skill = require('./skill-manager.js');

class SpeakerIdSkill extends Skill {
    constructor() {
        super('speaker-id', 'Identification vocale des locuteurs');
    }

    /**
     * Retourne des informations sur le locuteur identifié
     */
    async getSpeakerInfo(speakerId) {
        const speakers = {
            'nicolas': {
                name: 'Nicolas',
                preferences: {
                    greeting: 'Salut Nicolas !',
                    formality: 'casual',
                    interests: ['technologie', 'programmation', 'science']
                },
                context: 'Papa de Jean, expert en technologie'
            },
            'natacha': {
                name: 'Natacha', 
                preferences: {
                    greeting: 'Bonjour Natacha !',
                    formality: 'friendly',
                    interests: ['famille', 'organisation', 'bien-être']
                },
                context: 'Maman de Jean, organise la vie de famille'
            },
            'enfant1': {
                name: 'Jean',
                preferences: {
                    greeting: 'Coucou mon petit Jean !',
                    formality: 'child-friendly',
                    interests: ['jeux', 'histoires', 'chansons']
                },
                context: 'Bébé de la famille, né le 6 mars 2026'
            }
        };

        return speakers[speakerId] || null;
    }

    /**
     * Génère un contexte personnalisé pour le prompt Claude
     */
    async generateContextForSpeaker(speakerId) {
        const speakerInfo = await this.getSpeakerInfo(speakerId);
        
        if (!speakerInfo) {
            return 'L\'utilisateur n\'est pas identifié.';
        }

        const context = [
            `L'utilisateur qui parle est ${speakerInfo.name}.`,
            `Contexte: ${speakerInfo.context}`,
            `Style de communication préféré: ${speakerInfo.preferences.formality}`,
            `Centres d'intérêt: ${speakerInfo.preferences.interests.join(', ')}`
        ].join(' ');

        return context;
    }

    /**
     * Adapte la réponse selon le locuteur
     */
    async personalizeResponse(response, speakerId) {
        const speakerInfo = await this.getSpeakerInfo(speakerId);
        
        if (!speakerInfo) {
            return response;
        }

        // Adaptations basiques selon le locuteur
        if (speakerId === 'enfant1') {
            // Simplifier le langage pour un enfant
            response = response.replace(/\b(cependant|néanmoins|toutefois)\b/gi, 'mais');
            response = response.replace(/\b(optimiser|améliorer)\b/gi, 'rendre mieux');
        } else if (speakerInfo.preferences.formality === 'casual') {
            // Style plus décontracté pour Nicolas
            response = response.replace(/\bJe vous\b/g, 'Je te');
            response = response.replace(/\bvous êtes\b/g, 'tu es');
        }

        return response;
    }

    /**
     * Log des interactions pour apprentissage
     */
    async logSpeakerInteraction(speakerId, query, response) {
        const timestamp = new Date().toISOString();
        console.log(`[SpeakerID] ${timestamp} - ${speakerId}: "${query}" -> "${response.substring(0, 50)}..."`);
        
        // TODO: Sauvegarder dans un fichier de log pour améliorer l'identification
        // et personnaliser davantage les réponses
    }

    /**
     * Statistics des locuteurs
     */
    async getSpeakerStats() {
        // TODO: Implémenter des statistiques d'usage par locuteur
        return {
            totalIdentifications: 0,
            bySpeaker: {}
        };
    }

    async canHandle(query, context) {
        // Cette skill est passive, elle ne traite pas de requêtes directes
        // Elle fournit juste des services aux autres skills
        return false;
    }

    async handle(query, context) {
        return "Cette skill fournit des services d'identification vocale aux autres composants.";
    }
}

module.exports = SpeakerIdSkill;