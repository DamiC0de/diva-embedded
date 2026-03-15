/**
 * Skill: Calculatrice mathématique
 */
export default {
    name: "calculator",
    description: "Calculs mathématiques et conversions",
    tools: [
        {
            name: "calculate",
            description: "Perform mathematical calculations",
            schema: {
                type: "object",
                properties: {
                    expression: { type: "string", description: "Mathematical expression to evaluate" }
                },
                required: ["expression"]
            }
        },
        {
            name: "convert_units",
            description: "Convert between units",
            schema: {
                type: "object",
                properties: {
                    value: { type: "number", description: "Value to convert" },
                    from: { type: "string", description: "Source unit" },
                    to: { type: "string", description: "Target unit" }
                },
                required: ["value", "from", "to"]
            }
        }
    ],

    async handler(toolName, input) {
        if (toolName === "calculate") {
            return this.calculate(input);
        } else if (toolName === "convert_units") {
            return this.convertUnits(input);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    },

    calculate(input) {
        const expression = input.expression ?? "";
        if (!expression) return "Erreur: expression vide.";
        
        try {
            // Nettoyer l'expression
            const clean = this.sanitizeExpression(expression);
            
            // Évaluer de manière sécurisée
            const result = this.safeEval(clean);
            
            return `${expression} = ${result}`;
        } catch (err) {
            return `Erreur de calcul: ${err.message}`;
        }
    },

    convertUnits(input) {
        const value = input.value ?? 0;
        const from = input.from?.toLowerCase() ?? "";
        const to = input.to?.toLowerCase() ?? "";
        
        if (!from || !to) return "Erreur: unités non spécifiées.";
        
        try {
            const result = this.performConversion(value, from, to);
            return `${value} ${from} = ${result} ${to}`;
        } catch (err) {
            return `Erreur de conversion: ${err.message}`;
        }
    },

    sanitizeExpression(expr) {
        // Remplacer les opérateurs français
        return expr
            .replace(/×/g, "*")
            .replace(/÷/g, "/")
            .replace(/,/g, ".")
            // Supprimer tout ce qui n'est pas chiffre, opérateur ou parenthèses
            .replace(/[^0-9+\-*/.() ]/g, "")
            .trim();
    },

    safeEval(expr) {
        // Évaluation sécurisée sans eval()
        const allowedChars = /^[0-9+\-*/.() ]+$/;
        if (!allowedChars.test(expr)) {
            throw new Error("Expression non autorisée");
        }
        
        // Utiliser Function constructor (plus sûr qu'eval)
        return new Function(`"use strict"; return (${expr})`)();
    },

    performConversion(value, from, to) {
        // Conversions basiques
        const conversions = {
            // Longueur
            "m": { "cm": 100, "mm": 1000, "km": 0.001, "ft": 3.28084, "in": 39.3701 },
            "cm": { "m": 0.01, "mm": 10, "km": 0.00001, "ft": 0.0328084, "in": 0.393701 },
            "km": { "m": 1000, "cm": 100000, "mm": 1000000, "ft": 3280.84, "in": 39370.1 },
            
            // Poids
            "kg": { "g": 1000, "lb": 2.20462, "oz": 35.274 },
            "g": { "kg": 0.001, "lb": 0.00220462, "oz": 0.035274 },
            "lb": { "kg": 0.453592, "g": 453.592, "oz": 16 },
            
            // Température
            "celsius": { "fahrenheit": (c) => c * 9/5 + 32, "kelvin": (c) => c + 273.15 },
            "fahrenheit": { "celsius": (f) => (f - 32) * 5/9, "kelvin": (f) => (f - 32) * 5/9 + 273.15 },
        };
        
        const fromUnit = conversions[from];
        if (!fromUnit) throw new Error(`Unité inconnue: ${from}`);
        
        const converter = fromUnit[to];
        if (!converter) throw new Error(`Conversion impossible: ${from} -> ${to}`);
        
        if (typeof converter === "function") {
            return converter(value);
        } else {
            return value * converter;
        }
    }
};
