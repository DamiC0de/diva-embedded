/**
 * Sanitizer pour les entrées utilisateur
 */
export class InputSanitizer {
    
    /**
     * Nettoyer le texte utilisateur avant envoi à Claude
     */
    sanitizeUserInput(text) {
        if (!text || typeof text !== "string") return "";
        
        return text
            // Limiter la taille
            .slice(0, 1000)
            // Supprimer les caractères de contrôle dangereux
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
            // Normaliser les espaces
            .replace(/\s+/g, " ")
            .trim();
    }

    /**
     * Vérifier si le texte contient des patterns suspects
     */
    containsSuspiciousPatterns(text) {
        const suspiciousPatterns = [
            // Injection attempts
            /prompt[:\s]*ignore/i,
            /system[:\s]*override/i,
            /forget.*previous/i,
            /disregard.*instructions/i,
            // Tentatives de récupération d'infos sensibles
            /api[_\s]*key/i,
            /token/i,
            /password/i,
            /secret/i,
            // Scripts
            /<script/i,
            /javascript:/i,
            /data:.*base64/i
        ];

        return suspiciousPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Filtrer les logs pour éviter l'exposition de données sensibles
     */
    sanitizeForLogging(text) {
        if (!text || typeof text !== "string") return "";
        
        return text
            // Masquer les clés API
            .replace(/sk-[a-zA-Z0-9]{32,}/g, "sk-****")
            .replace(/Bearer\s+[a-zA-Z0-9_-]+/g, "Bearer ****")
            // Masquer les tokens
            .replace(/token["\s:=]+[a-zA-Z0-9_-]{20,}/gi, "token: ****")
            // Masquer les URLs avec auth
            .replace(/https?:\/\/[^\/\s]*:[^@\s]*@[^\s]*/g, "https://****:****@****")
            // Limiter la longueur pour les logs
            .slice(0, 200);
    }

    /**
     * Valider les paramètres d'API
     */
    validateApiInput(input) {
        if (!input || typeof input !== "object") {
            throw new Error("Invalid input: must be an object");
        }

        // Limites de taille
        const maxStringLength = 2000;
        const maxObjectDepth = 3;

        function validateValue(value, depth = 0) {
            if (depth > maxObjectDepth) {
                throw new Error("Input object too deep");
            }

            if (typeof value === "string") {
                if (value.length > maxStringLength) {
                    throw new Error(`String too long: ${value.length} > ${maxStringLength}`);
                }
                
                if (this.containsSuspiciousPatterns(value)) {
                    throw new Error("Input contains suspicious patterns");
                }
            } else if (Array.isArray(value)) {
                if (value.length > 100) {
                    throw new Error("Array too long");
                }
                value.forEach(item => validateValue.call(this, item, depth + 1));
            } else if (typeof value === "object" && value !== null) {
                if (Object.keys(value).length > 20) {
                    throw new Error("Object has too many properties");
                }
                Object.values(value).forEach(val => validateValue.call(this, val, depth + 1));
            }
        }

        validateValue.call(this, input);
        return true;
    }
}

export const inputSanitizer = new InputSanitizer();
