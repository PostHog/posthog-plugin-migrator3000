import { Plugin, PluginEvent } from '@posthog/plugin-scaffold'
import fetch from 'node-fetch'

export interface Migrator3000MetaInput {
    global: {
        versionMinor: number
        versionMajor: number
    }
    config: {
        host: string
        projectApiKey: string
        posthogVersion: string
    }
}

interface PluginEventExtra extends PluginEvent {
    $token?: string
    project_id?: string
    api_key?: string
}

const ELEMENT_TRANSFORMATIONS: Record<string, string> = {
    text: '$el_text',
    attr_class: 'attr__class',
    attr_id: 'attr__id',
    href: 'attr__href'
}

const parseAndSendEvents = async (events: PluginEventExtra[], { config, global }: Migrator3000MetaInput) => {
    const batch = []
    for (const event of events) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { team_id, now, offset, sent_at, $token, project_id, api_key, ...sendableEvent } = {
            ...event,
            token: config.projectApiKey,
        }


        if (sendableEvent.properties && sendableEvent.properties.$elements) {
            const newElements = []
            for (const element of sendableEvent.properties.$elements) {
                for (const [key, val] of Object.entries(element)) {
                    if (key in ELEMENT_TRANSFORMATIONS) {
                        element[ELEMENT_TRANSFORMATIONS[key]] = val
                        delete element[key]
                    }
                }
                newElements.push({ ...element.attributes, ...element })
                delete element['attributes']
            }
            sendableEvent.properties.$elements = newElements
        }
        sendableEvent.timestamp = event.timestamp || new Date(Date.now()).toISOString()
        batch.push(sendableEvent)
    }

    if (batch.length > 0) {
        const res = await fetch(`https://${config.host}/e`, {
            method: 'POST',
            body: JSON.stringify(batch),
            headers: { 'Content-Type': 'application/json' },
        })
        if (global.debug) {
            const textRes = await res.text()
            console.log('RESPONSE:', textRes)
        }
        console.log(`Flushing ${batch.length} event${batch.length > 1 ? 's' : ''} to ${config.host}`)
    } else if (global.debug) {
        console.log('Skipping empty batch of events')
    }
}

const plugin: Plugin<Migrator3000MetaInput> = {
    setupPlugin: async ({ config, global }) => {
        if (config.posthogVersion === "Latest" || config.posthogVersion === "1.30.0+") {
            global.versionMajor = 1
            global.versionMinor = 31
            return
        }

        try {
            const parsedVersion = config.posthogVersion.split('.').map(digit => Number(digit))
            global.versionMajor = parsedVersion[0]
            global.versionMinor = parsedVersion[1]
        } catch (e) {
            throw new Error('Invalid PostHog version')
        }
    },
    exportEvents: async (events: PluginEventExtra[], meta) => {
        if (events.length === 0) {
            return
        }

        // dont export live events, only historical ones
        if (meta.global.versionMajor > 1 || (meta.global.versionMajor === 1 && meta.global.versionMinor > 29)) {
            if (!events[0].properties || !events[0].properties['$$is_historical_export_event']) {
                return
            }
        } else if (events[0].uuid) {
            return
        }

        await parseAndSendEvents(events, meta)
    },
}

module.exports = plugin
