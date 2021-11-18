import { Plugin, PluginEvent } from '@posthog/plugin-scaffold'
import fetch from 'node-fetch'

export interface Migrator3000MetaInput {
    global: {
        startDate: string
        debug: boolean
        versionMinor: number
        versionMajor: number
    }
    config: {
        host: string
        projectApiKey: string
        startDate: string
        debug: 'ON' | 'OFF'
        posthogVersion: string
    }
}

interface PluginEventExtra extends PluginEvent {
    $token?: string
    project_id?: string
    api_key?: string
}

const TEN_MINUTES = 10 * 60 * 1000

const plugin: Plugin<Migrator3000MetaInput> = {
    runEveryMinute: async ({ global, jobs, storage, cache }) => {
        const currentDate = new Date()
        const lastRun = await cache.get('last_run', null)
        if (!lastRun || currentDate.getTime() - Number(lastRun) > TEN_MINUTES) {
            // this "magic" key is added via the historical export upgrade
            const isExportRunning = await storage.get('is_export_running', false)
            if (isExportRunning) {
                return
            }

            const previousMaxDate = await storage.get('max_date', global.startDate)

            await jobs['Export historical events']({
                dateFrom: previousMaxDate,
                dateTo: currentDate.toISOString(),
            }).runNow()

            console.log(`Now starting export of events from ${previousMaxDate} to ${currentDate.toISOString()}`)
            await storage.set('max_date', currentDate.toISOString())
            await cache.set('last_run', currentDate.getTime())
        }
    },

    setupPlugin: async ({ config, global }) => {
        try {
            global.startDate = new Date(config.startDate).toISOString()
        } catch (e) {
            console.log(`Failed to parse start date. Make sure to use the format YYYY-MM-DD`)
            throw e
        }
        global.debug = config.debug === 'ON'
        try {
            const parsedVersion = config.posthogVersion.split('.').map(digit => Number(digit))
            global.versionMajor = parsedVersion[0]
            global.versionMinor = parsedVersion[1]
        } catch (e) {
            throw new Error('Invalid PostHog version')
        }
    },
    exportEvents: async (events: PluginEventExtra[], { config, global }) => {
        // dont export live events, only historical ones
        if (events.length === 0) {
            return
        }
        if (global.versionMajor > 1 || (global.versionMajor === 1 && global.versionMinor > 29)) {
            if (!events[0].properties || !events[0].properties['$$is_historical_export_event']) {
                return
            }
        } else if (events[0].uuid) {
            return
        }

        const batch = []
        for (const event of events) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { team_id, now, offset, sent_at, $token, project_id, api_key, ...sendableEvent } = {
                ...event,
                token: config.projectApiKey,
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
                const jsonRes = await res.json()
                console.log('RESPONSE:', jsonRes)
            }
            console.log(`Flushing ${batch.length} event${batch.length > 1 ? 's' : ''} to ${config.host}`)
        } else if (global.debug) {
            console.log('Skipping empty batch of events')
        }

    },
}

module.exports = plugin
