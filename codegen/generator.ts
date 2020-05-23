import { Capability, CapabilityAttributeSchema, CapabilityJSONSchema, CapabilityReference, Component, Device, SmartThingsClient } from "@smartthings/core-sdk";
import { format, identifier, retry, throttle, sortByIdentifier } from "./utils";
import fs from 'fs';
import stringify from 'json-stable-stringify';

export async function stgen(client: SmartThingsClient, options: { outputDir: string }): Promise<void> {
    let result = generate(await getAllSmartThingsData(client));
    fs.mkdirSync(options.outputDir, { recursive: true });
    result.forEach(file => {
        fs.writeFileSync(`${options.outputDir}/${file.fileName}`, file.source);
    });
}

export interface CapabilityMap {
    [name: string]: { [version: number]: Capability };
}

export interface SmartThingsData {
    devices: Device[];
    capabilities: CapabilityMap;
}

export async function getAllSmartThingsData(client: SmartThingsClient): Promise<SmartThingsData> {
    let devices = await retry(() => throttle(() => client.devices.list()));
    let allCapabilityReferences = devices.map(
        d => d.components?.map(c => c.capabilities) ?? []).flat(2);
    let capabilities: CapabilityMap = {};
    await Promise.all(allCapabilityReferences.map(cap => retry(async () => {
        if (capabilities[cap.id]?.[cap.version!]) {
            return;
        }
        capabilities[cap.id] = capabilities[cap.id] ?? {};
        capabilities[cap.id][cap.version!] = { name: cap.id };
        let capability = await throttle(() => client.capabilities.get(cap.id, cap.version!));
        capabilities[cap.id][cap.version!] = capability;
    })));
    return {
        devices,
        capabilities
    };
}

export function generate(data: SmartThingsData): { fileName: string, source: string }[] {
    let capabilities = format(`
    import * as stgen from "stgen";
    import {SmartThingsClient} from "@smartthings/core-sdk";

    ${generateCapabilityDefinitions(data.capabilities)}
    `);
    let devices = format(`
    import * as stgen from "stgen";
    import * as capabilities from "./capabilities";
    import {SmartThingsClient} from "@smartthings/core-sdk";

    ${generateDevices(data.devices)}
    `);

    return [
        { fileName: 'capabilities.ts', source: capabilities },
        { fileName: "devices.ts", source: devices }
    ];
}

function generateCapabilityDefinitions(capabilities: CapabilityMap): string {
    let result = "";
    for (const cap of Object.keys(capabilities).sort()) {
        result += `export namespace ${identifier(cap)} {`;
        for (const version of Object.keys(capabilities[cap]).sort()) {
            result += `export namespace v${version} {
                ${generateCapabilityDefinition(capabilities[cap][+version])}
            }`;
        }
        result += `}`;
    }
    return result;
}


function generateCapabilityDefinition(capability: Capability): string {
    var result = `
    export interface Status {
        ${generateAttributes(capability)}
    }
    export class Capability<TComponent extends stgen.Component<any, TDevice>, TDevice extends stgen.Device<any>> extends stgen.Capability<Status, TComponent, TDevice> {
        constructor(component: TComponent) {
            super(component, ${stringify(capability)} as any);

            // TODO: add commands
        }
    };
    `
    return result;
}

function generateAttributes(capability: Capability): string {
    if (!capability.attributes) {
        return "";
    }
    let result = "";
    for (const name of Object.keys(capability.attributes!).sort()) {
        let attr = capability.attributes[name];
        result += `"${name}" : {${generateSchemaProperties(attr.schema)}},`;
    }
    return result;
}

function generateSchemaProperties(schema: CapabilityAttributeSchema): string {
    let properties = [];
    properties.push(`value: ${generateInnerTypes(schema.properties.value)}`);
    if (schema.properties.unit) {
        properties.push(`unit?: ${generateInnerTypes(schema.properties.unit)}`);
    }
    if (schema.properties.data) {
        properties.push(`data: ${generateInnerTypes(schema.properties.data)}`);
    }
    return properties.join(',');
}

interface Types {
    type?: string,
    enum?: string[],
    items?: Types,
    properties?: {
        [name: string]: CapabilityJSONSchema;
    }
}

function generateInnerTypes(property: Types): string {
    switch (property.type) {
        case "string":
            if (property.enum) {
                return property.enum.map(v => `"${v}"`).join("|");
            }
            return "string";
        case "integer":
        case "number":
            return "number";
        case "array":
            if (property.items) {
                return `${generateInnerTypes(property.items!)}[]`;
            }
            return "any[]";
        case "object":
            if (property.properties) {
                let props = [];
                for (const inner of Object.keys(property.properties).sort()) {
                    props.push(`"${inner}": ${generateInnerTypes(property.properties[inner])}`);
                }
                return `{${props.join(',')}}`
            } else {
                return "any";
            }
        default:
            throw new Error("Unknown type");
    }
}

function generateDevices(devices: Device[]): string {
    let seenNames = new Set<string>();
    return devices.sort((a, b) => a.label!.localeCompare(b.label!)).map(d => {
        let name = identifier(d.label!);
        let lowerName = identifier(d.label!, true);
        if (seenNames.has(name)) {
            let combinedLabel = d.label! + '_' + d.deviceId;
            name = identifier(combinedLabel);
            lowerName = identifier(combinedLabel, true);
        }
        seenNames.add(name);
        return `
        /**
         * Gets a device client for "${d.label}"
         * 
         * @param client a SmartThingsClient.  If none is provided, uses the default set using {@link module:stgen.setDefaultClient}
         */
        export function ${lowerName}(client?: SmartThingsClient): ${name}.Device {
            return new ${name}.Device(client ?? stgen.getDefaultClient());
        }
        export namespace ${name} {
            export interface Status {
                ${d.components?.sort(sortByIdentifier).map(c => `"${c.id}": Components.${identifier(c.id!)}.Status`).join(',\n')}
            }
            export class Device extends stgen.Device<Status> {
                constructor(client: SmartThingsClient) {
                    super(client, ${stringify(d)} as any);
                }

                ${d.components?.sort(sortByIdentifier).map(c => `
                /**
                 * Component client for "${[c.label, c.id].filter(s => !!s).join(' - ')}"
                 */
                readonly ${identifier(c.id!, true)} = new Components.${identifier(c.id!)}.Component(this);
                `).join('\n')}
            }
            export namespace Components {
                ${generateComponentDefinitions(d.components!)}
            }
        }
        `
    }).join('\n');
}

function capabilityNamespace(capability: CapabilityReference): string {
    return `capabilities.${identifier(capability.id)}.v${capability.version}`
}

function generateComponentDefinitions(components: Component[]): string {
    return components.sort(sortByIdentifier).map(c => `
        export namespace ${identifier(c.id!)} {
            export interface Status {
                ${c.capabilities.sort(sortByIdentifier).map(c => `"${c.id}": ${capabilityNamespace(c)}.Status`).join(',\n')}
            }
            export class Component extends stgen.Component<Status, Device> {
                constructor(device: Device) {
                    super(device, ${stringify(c)} as any);
                }

                ${c.capabilities.sort(sortByIdentifier).map(c => `
                /**
                 * Capability client for "${c.id}"
                 */
                readonly ${identifier(c.id, true)} = new ${capabilityNamespace(c)}.Capability<Component, Device>(this);
                `).join('\n')}
            }
        }
    `).join('\n');
}

