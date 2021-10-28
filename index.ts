import { Plugin, PluginEvent } from '@posthog/plugin-scaffold'
import fetch from 'node-fetch'

export interface Migrator3000MetaInput {
    global: {
        startDate: string
    }
    config: {
        host: string
        projectApiKey: string
        startDate: string
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
            await storage.set('current_max_date', currentDate.toISOString())
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
    },
    exportEvents: async (events: PluginEventExtra[], { config }) => {
        // dont export live events, only historical ones
        if (events.length > 0 && events[0].uuid) {
            return
        }
        const batch = []
        for (const event of events) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { team_id, now, offset, sent_at, $token, project_id, api_key, ...sendableEvent } = {
                ...event,
                token: config.projectApiKey,
            }
            sendableEvent.timestamp = new Date(event.timestamp || Date.now()).toISOString()
            batch.push(sendableEvent)
        }

        if (batch.length > 0) {
            await fetch(`https://${config.host}/e`, {
                method: 'POST',
                body: JSON.stringify(batch),
                headers: { 'Content-Type': 'application/json' },
            })
            console.log(`Flushing ${batch.length} event${batch.length > 1 ? 's' : ''} to ${config.host}`)
        }
    },
}

module.exports = plugin
