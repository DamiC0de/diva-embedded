/**
 * Home Assistant Connector — bidirectional integration via REST API
 *
 * YAML config maps French voice names to HA entity IDs:
 *   "lumière du salon": "light.salon"
 *   "chauffage": "climate.thermostat"
 */
interface EntityMapping {
    voiceName: string;
    entityId: string;
    domain: string;
    area?: string;
}
export declare function handleHomeCommand(text: string): Promise<{
    handled: boolean;
    response?: string;
}>;
export declare function getHAEntityState(entityId: string): Promise<unknown>;
export declare function isHAConfigured(): boolean;
export declare function getEntityMappings(): EntityMapping[];
export {};
//# sourceMappingURL=ha-connector.d.ts.map