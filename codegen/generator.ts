import {
  Capability,
  CapabilityAttributeSchema,
  CapabilityJSONSchema,
  CapabilityReference,
  CapabilitySchemaPropertyName,
  Component,
  CustomCapabilityStatus,
  Device,
  Location,
  Room,
  SceneSummary,
  SmartThingsClient,
} from '@smartthings/core-sdk';
import fs from 'fs';
import stringify from 'json-stable-stringify';
import { flat, format, identifier, lowerCase, retry, sortByIdentifier, throttle } from './utils';

export async function stgen(
  client: SmartThingsClient,
  options: { outputDir: string }
): Promise<void> {
  const result = generate(await getAllSmartThingsData(client));
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
  scenes: SceneSummary[];
  rooms: Room[];
  locations: Location[];
}

interface BuiltContext {
  deviceMethodNames?: { [deviceId: string]: string };
  locationMethodNames?: { [locationId: string]: string };
  roomClassNames?: { [roomId: string]: string };
}

export async function getAllSmartThingsData(client: SmartThingsClient): Promise<SmartThingsData> {
  const [devices, scenes, locationRefs] = await Promise.all([
    client.devices.list(),
    client.scenes.list(),
    client.locations.list(),
  ]);
  const allCapabilityReferences = flat(
    devices.map(d => flat(d.components?.map(c => c.capabilities) ?? []))
  );
  const capabilities: CapabilityMap = {};
  await Promise.all(
    allCapabilityReferences.map(cap =>
      retry(async () => {
        if (capabilities[cap.id] && capabilities[cap.id][cap.version!]) {
          return;
        }
        capabilities[cap.id] = capabilities[cap.id] ?? {};
        capabilities[cap.id][cap.version!] = { name: cap.id };
        const capability = await throttle(() => client.capabilities.get(cap.id, cap.version!));
        capabilities[cap.id][cap.version!] = capability;
      })
    )
  );
  const locations = await Promise.all(
    locationRefs.map(ref => retry(() => throttle(() => client.locations.get(ref.locationId))))
  );
  const rooms = flat(
    await Promise.all(
      locations.map(l => retry(() => throttle(() => client.rooms.list(l.locationId))))
    )
  );
  return {
    devices,
    capabilities,
    scenes,
    rooms,
    locations,
  };
}

export function generate(data: SmartThingsData): { fileName: string; source: string }[] {
  const context: BuiltContext = {};

  return [
    { fileName: 'capabilities.ts', source: format(generateCapabilities(data.capabilities)) },
    { fileName: 'devices.ts', source: format(generateDevices(data.devices, context)) },
    { fileName: 'scenes.ts', source: format(generateScenes(data.scenes)) },
    { fileName: 'locations.ts', source: format(generateLocations(data, context)) },
  ];
}

function generateCapabilities(capabilities: CapabilityMap): string {
  let result = `
    /* eslint-disable @typescript-eslint/no-namespace */
    /* eslint-disable @typescript-eslint/no-empty-interface */
    import * as stgen from "@stgen/stgen";
    import * as st from "@smartthings/core-sdk";

    `;
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

function capabilityNotices(capability: Capability): string {
  switch (capability.status) {
    case CustomCapabilityStatus.DEAD:
    case CustomCapabilityStatus.DEPRECATED:
      return `@deprecated Capability status is ${capability.status}`;
    case CustomCapabilityStatus.PROPOSED:
      return `@experimental Capability status is ${capability.status}`;
    default:
      return '';
  }
}

function generateCapabilityDefinition(capability: Capability): string {
  const result = `
    /**
     * Status type for ${capability.name} v${capability.version}
     * ${capabilityNotices(capability)}
     */
    export interface Status {
        ${generateAttributes(capability)}
    }
    /**
     * Rich client for ${capability.name} v${capability.version}
     * ${capabilityNotices(capability)}
     */
    export class Capability<TComponent extends stgen.Component<unknown, TDevice>, TDevice extends stgen.Device<unknown>> extends stgen.Capability<Status, TComponent, TDevice> {
        constructor(component: TComponent) {
            super(component, ${stringify(capability)} as unknown as st.Capability);
        }
        ${generateCommands(capability)}
    };
    `;
  return result;
}

function generateCommands(capability: Capability): string {
  if (!capability.commands) {
    return '';
  }
  const commands = capability.commands!;
  return Object.keys(commands)
    .sort()
    .map(cmdKey => {
      const cmd = commands[cmdKey];
      return `
        /**
         * Executes "${cmd.name ?? cmdKey}" for this capability
         */
        ${identifier(cmd.name ?? cmdKey, true)}(${(cmd.arguments ?? [])
        .map(
          arg => `${identifier(arg.name, true)}${arg.optional ? '?' : ''}: \
                             ${generateInnerTypes(arg.schema, false)}`
        )
        .join(', ')}): Promise<st.Status> {
            return this.client.devices.executeCommand(this.device.id, {
                component: this.component.id,
                capability: this.id,
                command: "${cmd.name ?? cmdKey}",
                arguments: [
                    ${(cmd.arguments ?? [])
                      .map(arg => `${identifier(arg.name, true)}${arg.optional ? '!' : ''}`)
                      .join(', ')}
                ]
            });
        }
        `;
    })
    .join('\n');
}

function generateAttributes(capability: Capability): string {
  if (!capability.attributes) {
    return '';
  }
  let result = '';
  for (const name of Object.keys(capability.attributes!).sort()) {
    const attr = capability.attributes[name];
    result += `"${name}" : {${generateSchemaProperties(attr.schema)}},`;
  }
  return result;
}

function generateSchemaProperties(schema: CapabilityAttributeSchema): string {
  function optionalModifier(key: CapabilitySchemaPropertyName) {
    return schema.required?.includes(key) ? '' : '?';
  }
  const properties = [];
  properties.push(
    `value${optionalModifier(CapabilitySchemaPropertyName.VALUE)}: ${generateInnerTypes(
      schema.properties.value
    )}`
  );
  if (schema.properties.unit) {
    properties.push(
      `unit${optionalModifier(CapabilitySchemaPropertyName.UNIT)}: ${generateInnerTypes(
        schema.properties.unit
      )}`
    );
  }
  if (schema.properties.data) {
    properties.push(
      `data${optionalModifier(CapabilitySchemaPropertyName.DATA)}: ${generateInnerTypes(
        schema.properties.data,
        true
      )}`
    );
  }
  return properties.join(',');
}

interface Types {
  type?: string;
  enum?: string[];
  items?: Types | [Types];
  properties?: {
    [name: string]: CapabilityJSONSchema;
  };
  required?: string[];
}

function generateInnerTypes(property: Types, required = false): string {
  switch (property.type) {
    case 'string':
      if (property.enum) {
        return property.enum.map(v => `"${v}"`).join('|');
      }
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'array':
      if (property.items) {
        const items = Array.isArray(property.items) ? property.items[0] : property.items;
        return `${generateInnerTypes(items)}[]`;
      }
      return 'any[]';
    case 'object':
      if (property.properties) {
        function optional(key: string) {
          return required && property.required?.includes(key) ? '' : '?';
        }
        const props = [];
        for (const inner of Object.keys(property.properties).sort()) {
          const {
            type: _type,
            enum: _enum,
            items: _items,
            properties: _properties,
            required: _required,
            ...prunedInner
          } = property.properties[inner] as Types;
          props.push(`
                    /**
                     * ${stringify(prunedInner)}
                     */
                    "${inner}"${optional(inner)}: ${generateInnerTypes(
            property.properties[inner]
          )}`);
        }
        return `{${props.join(',')}}`;
      } else {
        return 'any';
      }
    default:
      throw new Error('Unknown type');
  }
}

function generateDevices(devices: Device[], context: BuiltContext): string {
  context.deviceMethodNames = {};
  const seenNames = new Set<string>();
  return `
    /* eslint-disable @typescript-eslint/no-namespace */
    /* eslint-disable @typescript-eslint/no-empty-interface */
    import * as stgen from "@stgen/stgen";
    import * as capabilities from "./capabilities";
    import * as st from "@smartthings/core-sdk"
    ${devices
      .sort((a, b) => a.label!.localeCompare(b.label!))
      .map(d => {
        let name = identifier(d.label!);
        let lowerName = identifier(d.label!, true);
        if (seenNames.has(name)) {
          const combinedLabel = d.label! + '_' + d.deviceId;
          name = identifier(combinedLabel);
          lowerName = identifier(combinedLabel, true);
        }
        seenNames.add(name);
        context.deviceMethodNames![d.deviceId!] = lowerName;
        return `
        /**
         * Gets a device client for "${d.label}"
         * 
         * @param client a SmartThingsClient.  If none is provided, uses the default set using {@link module:stgen.setDefaultClient}
         */
        export function ${lowerName}(client?: st.SmartThingsClient): ${name}.Device {
            return new ${name}.Device(client ?? stgen.getDefaultClient());
        }
        export namespace ${name} {
            export interface Status {
                components: {
                    ${d.components
                      ?.sort(sortByIdentifier)
                      .map(c => `"${c.id}": Components.${identifier(c.id!)}.Status`)
                      .join(',\n')}
                }
            }
            export class Device extends stgen.Device<Status> {
                constructor(client: st.SmartThingsClient) {
                    super(client, ${stringify(d)} as unknown as st.Device);
                }

                ${d.components
                  ?.sort(sortByIdentifier)
                  .map(
                    c => `
                /**
                 * Component client for "${[c.label, c.id].filter(s => !!s).join(' - ')}"
                 */
                readonly ${identifier(c.id!, true)} = new Components.${identifier(
                      c.id!
                    )}.Component(this);
                `
                  )
                  .join('\n')}
            }
            export namespace Components {
                ${generateComponentDefinitions(d.components!)}
            }
        }
        `;
      })
      .join('\n')}
    `;
}

function capabilityNamespace(capability: CapabilityReference): string {
  return `capabilities.${identifier(capability.id)}.v${capability.version}`;
}

function generateComponentDefinitions(components: Component[]): string {
  return components
    .sort(sortByIdentifier)
    .map(
      c => `
        export namespace ${identifier(c.id!)} {
            export interface Status {
                ${c.capabilities
                  .sort(sortByIdentifier)
                  .map(c => `"${c.id}": ${capabilityNamespace(c)}.Status`)
                  .join(',\n')}
            }
            export class Component extends stgen.Component<Status, Device> {
                constructor(device: Device) {
                    super(device, ${stringify(c)} as unknown as st.Component);
                }

                ${c.capabilities
                  .sort(sortByIdentifier)
                  .map(
                    c => `
                /**
                 * Capability client for "${c.id}"
                 */
                readonly ${identifier(c.id, true)} = new ${capabilityNamespace(
                      c
                    )}.Capability<Component, Device>(this);
                `
                  )
                  .join('\n')}
            }
        }
    `
    )
    .join('\n');
}

export function generateScenes(scenes: SceneSummary[]): string {
  // Remove dates from scenes so that generated code doesn't change constantly
  scenes = scenes.map(scene => {
    const {
      lastExecutedDate: _lastExecutedDate,
      lastUpdatedDate: _lastUpdatedDate,
      createdDate: _createdDate,
      ...newScene
    } = scene;
    return newScene;
  });
  return `
    /* eslint-disable @typescript-eslint/no-namespace */
    /* eslint-disable @typescript-eslint/no-empty-interface */
    import * as stgen from "@stgen/stgen";
    import * as st from "@smartthings/core-sdk";

    ${scenes
      .map(
        scene => `
    export function ${identifier(scene.sceneName!, true)}(client: st.SmartThingsClient):
        ${identifier(scene.sceneName!)} {
        return new ${identifier(scene.sceneName!)}(client);
    }
    export class ${identifier(scene.sceneName!)} extends stgen.Scene {
        constructor(client: st.SmartThingsClient) {
            super(client, ${stringify(scene)} as unknown as st.SceneSummary);
        }
    }
    `
      )
      .join('\n')}
    `;
}

function generateLocations(data: SmartThingsData, context: BuiltContext): string {
  context.locationMethodNames = {};
  const seenNames = new Set<string>();
  return `
    /* eslint-disable @typescript-eslint/no-namespace */
    /* eslint-disable @typescript-eslint/no-empty-interface */
    import * as stgen from "@stgen/stgen";
    import * as st from "@smartthings/core-sdk";
    import * as devices from "./devices";

    ${data.locations
      .map(l => {
        let name = identifier(l.name);
        let lowerName = identifier(l.name, true);
        if (seenNames.has(name)) {
          const combinedLabel = l.name! + '_' + l.locationId;
          name = identifier(combinedLabel);
          lowerName = identifier(combinedLabel, true);
        }
        seenNames.add(name);
        context.locationMethodNames![l.locationId] = lowerName;
        const rooms = data.rooms
          .filter(r => r.locationId == l.locationId)
          .sort((r1, r2) => r1.name!.localeCompare(r2.name!));
        const roomlessDevices = data.devices
          .filter(d => d.locationId == l.locationId && !d.roomId)
          .sort((d1, d2) => d1.name!.localeCompare(d2.name!));
        return `
        export function ${lowerName}(client: st.SmartThingsClient): ${name}.Location {
            return new ${name}.Location(client);
        }
        export namespace ${name} {
            export namespace Rooms {
                ${generateRooms(rooms, data, context)}
            }

            export class Location extends stgen.Location {
                constructor(client: st.SmartThingsClient) {
                    super(client, ${stringify(l)} as unknown as st.Location);
                }

                ${rooms
                  .map(
                    r => `
                readonly ${lowerCase(context.roomClassNames![r.roomId!])} = new Rooms.${
                      context.roomClassNames![r.roomId!]
                    }(this);
                `
                  )
                  .join('\n')}

                ${
                  roomlessDevices
                    ? `
                readonly noRoomAssigned = {
                    ${roomlessDevices
                      .map(
                        d => `
                    ${context.deviceMethodNames![d.deviceId!]}: devices.${
                          context.deviceMethodNames![d.deviceId!]
                        }(this.client)
                    `
                      )
                      .join(',\n')}
                } as const;
                `
                    : ''
                }
            }
        }
        `;
      })
      .join('\n')}
    `;
}

function generateRooms(rooms: Room[], data: SmartThingsData, context: BuiltContext): string {
  context.roomClassNames = {};
  const seenNames = new Set<string>();
  seenNames.add('NoRoom');
  return rooms
    .map(r => {
      let name = identifier(r.name!);
      if (seenNames.has(name)) {
        const combinedLabel = r.name! + '_' + r.roomId!;
        name = identifier(combinedLabel);
      }
      seenNames.add(name);
      context.roomClassNames![r.roomId!] = name;
      const devices = data.devices
        .filter(d => d.roomId == r.roomId)
        .sort((d1, d2) => d1.name!.localeCompare(d2.name!));
      return `
        export class ${name} extends stgen.Room<Location> {
            constructor(location: Location) {
                super(location, ${stringify(r)} as unknown as st.Location);
            }

            ${devices
              .map(
                d => `
            readonly ${context.deviceMethodNames![d.deviceId!]} = devices.${
                  context.deviceMethodNames![d.deviceId!]
                }(this.client);
            `
              )
              .join('\n')}
        }
        `;
    })
    .join('\n');
}
