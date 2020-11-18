import { DeviceEvent } from '@smartthings/core-sdk';
import { SmartApp, SmartAppOptions, SmartAppContext } from '@smartthings/smartapp';
import { AppEvent } from '@smartthings/smartapp/lib/lifecycle-events';
import { UnknownCapability } from './device';
import { StatusType, Select, ValueOf } from './utils';
import { v4 as uuidv4 } from 'uuid';

const STGEN_EVENT_PREFIX = 'stgen';
const INSTALLED_APP_IDS_TTL = 5 * 60 * 1000;

export interface EventType<
  TCapability extends UnknownCapability,
  attribute extends keyof StatusType<TCapability>
> extends AppEvent.DeviceEvent {
  attribute: Extract<attribute, string>;
  capability: Select<TCapability, 'id'>;
  value: ValueOf<StatusType<TCapability>, attribute>;
}

export interface EventDescription<TStatus, TAttributeName extends keyof TStatus> {
  attribute: TAttributeName;
  value: TStatus extends { [key in TAttributeName]: { value: infer TValue } } ? TValue : never;
  unit?: TStatus extends { [key in TAttributeName]: { unit: infer TUnit } } ? TUnit : never;
  data?: TStatus extends { [key in TAttributeName]: { data: infer TData } } ? TData : never;
}

/**
 * Provides a pre-configured SmartApp for use with STGen.
 */
export class STGenSmartApp extends SmartApp {
  #subscribedCapabilities = new Set<string>();
  #callbacks = new Set<(context: SmartAppContext, event: AppEvent.DeviceEvent) => void>();
  #appId = '';
  #lastInstalledAppIds?: { lastLookup: Date; ids: string[] };
  constructor(options?: SmartAppOptions) {
    super(options);
    this.appId('stgen-smartapp')
      .permissions([
        'r:devices:*',
        'w:devices:*',
        'x:devices:*',
        'r:locations:*',
        'r:scenes:*',
        'x:scenes:*',
        'r:installedapps:*',
        'w:installedapps:*',
        'l:installedapps',
      ])
      .page('mainPage', async (context, page, configData) => {
        const allDevices = await context.api.devices.list();
        const appDevices = allDevices.filter(
          d => d.app?.installedAppId == configData?.installedAppId
        );
        page.name('STGen');
        page.section('Instructions', section => {
          section.name('Instructions');
          section.paragraphSetting('instructions').name('Instructions').description(` \
                This is your STGen personal automation SmartApp. \
                There are no settings -- you just write and deploy your backend code by \
                following the instructions in the Github repository below.`);
          section
            .linkSetting('github')
            .name('Github')
            .url('https://github.com/stgen/stgen-smartapp')
            .description('STGen SmartApp Github Repository');
          section
            .textSetting('installedAppId')
            .name('Installed App ID')
            .disabled(true)
            .defaultValue(configData?.installedAppId ?? '');
        });
        page.section('CreateDevice', section => {
          section.name('Create a Virtual Device');
          if (appDevices.length >= 30) {
            section
              .paragraphSetting('createDisabledParagraph')
              .name('Unable to create devices')
              .description(
                'Please delete devices created by this app or install an additional instance of the app to create more devices.'
              );
          } else {
            section.pageSetting('createDevice').name('Create a Virtual Device');
          }
          section.paragraphSetting('deviceCount').name(`Device count: ${appDevices.length}/30`);
        });
      })
      .page('createDevice', async (context, page) => {
        const allDeviceProfiles = await context.api.deviceProfiles.list();
        const newDeviceID = `stgen-smartapp_${uuidv4()}`;
        page.name('Create a device');
        page.section('Device Creation', section => {
          section.name('Device Creation');
          section
            .textSetting(`createDevice/label`)
            .name('New device label')
            .description('A label for your new device')
            .required(true);
          section
            .enumSetting(`createDevice/deviceProfile`)
            .options(
              allDeviceProfiles.map(profile => ({
                id: profile.id,
                name: `${profile.name} (capabilities: ${profile.components
                  .reduce(
                    (prev, cur) => prev.concat((cur.capabilities ?? []).map(c => c.id)),
                    new Array<string>()
                  )
                  .join(', ')})`,
              }))
            )
            .required(true);
          section
            .textSetting(`createDevice/id`)
            .name('Unique Device ID')
            .required(true)
            .disabled(true)
            .defaultValue(newDeviceID);
        });
      })
      .updated(async (context, updateData) => {
        await context.api.subscriptions.delete();
        for (const cap of this.#subscribedCapabilities) {
          const sub = await context.api.subscriptions.subscribeToCapability(
            cap,
            '*',
            `${STGEN_EVENT_PREFIX}_${cap}`
          );
          console.log(sub);
        }
        if (context.configStringValue('createDevice/id')) {
          await context.api.devices.create({
            profileId: context.configStringValue('createDevice/deviceProfile'),
            label: context.configStringValue('createDevice/label'),
          });
          const updatedConfig = { ...context.config };
          delete updatedConfig['createDevice/id'];
          delete updatedConfig['createDevice/deviceProfile'];
          delete updatedConfig['createDevice/label'];
          await context.api.installedApps.updateConfiguration(
            updateData.installedApp.installedAppId,
            {
              config: updatedConfig,
            }
          );
          console.log('Created device');
        }
      })
      .subscribedEventHandler(STGEN_EVENT_PREFIX, (context, event) => {
        if (!this.#isPrimaryInstalledApp(context)) {
          return;
        }
        for (const callback of this.#callbacks) {
          callback(context, event);
        }
      })
      .installed((context, installData) => {
        this.#lastInstalledAppIds = undefined;
      })
      .uninstalled((context, uninstallData) => {
        this.#lastInstalledAppIds = undefined;
      });
  }

  /**
   * @override
   */
  appId(id: string): this {
    super.appId(id);
    this.#appId = id;
    return this;
  }

  #getSortedInstalledAppIds = async (context: SmartAppContext): Promise<string[]> => {
    if (
      !this.#lastInstalledAppIds ||
      new Date().getTime() - this.#lastInstalledAppIds.lastLookup.getTime() > INSTALLED_APP_IDS_TTL
    ) {
      const allInstalledApps = await context.api.installedApps.list();
      this.#lastInstalledAppIds = {
        lastLookup: new Date(),
        ids: allInstalledApps
          .filter(app => app.appId == this.#appId)
          .sort((a, b) => new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime())
          .map(app => app.installedAppId),
      };
    }

    return this.#lastInstalledAppIds.ids;
  };

  #isPrimaryInstalledApp = async (context: SmartAppContext): Promise<boolean> => {
    return (
      (await this.#getSortedInstalledAppIds(context))[0] ==
      context.configStringValue('installedAppId')
    );
  };

  subscribe<TCapability extends UnknownCapability>(
    capability: TCapability,
    callback: (context: SmartAppContext, event: AppEvent.DeviceEvent) => void
  ): this {
    this.#callbacks.add((context, event) => {
      if (
        event.capability == capability.id &&
        event.componentId == capability.component.id &&
        event.deviceId == capability.device.id
      ) {
        callback(context, event);
      }
    });
    this.#subscribedCapabilities.add(capability.id);
    return this;
  }

  subscribeAll(
    capabilities: UnknownCapability[],
    callback: (context: SmartAppContext, event: AppEvent.DeviceEvent) => void
  ): this {
    capabilities.forEach(cap => this.subscribe(cap, callback));
    return this;
  }

  /**
   * Sends events to a device owned by this application.
   *
   * Sending events to other devices
   * will fail.  Requires a ContextStore to be configured for the SmartApp so that events
   * can be sent out of band.
   *
   * @param capability The capability to send events for.
   * @param events The events to send.
   */
  async sendEvents<
    TCapability extends UnknownCapability,
    T extends EventDescription<StatusType<TCapability>, keyof StatusType<TCapability>>[]
  >(capability: TCapability, ...events: T): Promise<StatusType<TCapability>> {
    const decorated = events.map(
      e =>
        ({
          component: capability.component.id,
          capability: capability.id,
          ...e,
        } as DeviceEvent)
    );
    const installedAppId = capability.device.raw.app?.installedAppId;
    if (!installedAppId) {
      throw new Error('Device has no installed app ID');
    }
    const context = await this.withContext(capability.device.raw.app?.installedAppId ?? '');
    return ((await context.api.devices.createEvents(
      capability.device.id,
      decorated
    )) as unknown) as StatusType<TCapability>;
  }
}
