import { Plugin, PluginEvent } from '@posthog/plugin-scaffold'
import fetch from 'node-fetch'

export interface Migrator3000MetaInput {
    global: {
        startDate: string
    },
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

const plugin: Plugin<Migrator3000MetaInput> = {

    // every hour, check if we're done exporting the previous range and 
    // if not, start a new job to export from the last max to now
    runEveryHour: async ({ storage, jobs }) => {
        const isExportRunning = await storage.get('is_export_running', false)
        if (isExportRunning) {
            return
        }
        const previousMaxDate = await storage.get('max_date', null)
        if (!previousMaxDate) {
            throw new Error('How did you get here?')
        }

        const newMaxDate = new Date(Date.now()).toISOString()
        console.log(`Now starting export of events from ${previousMaxDate} to ${newMaxDate}`)
        await storage.set('current_max_date', newMaxDate)
        await jobs['Export historical events']({
            dateFrom: previousMaxDate,
            dateTo: newMaxDate,
        }).runNow()
    },

    // used to provide near-immediate feedback to users that their export has started
    runEveryMinute: async ({ global, jobs, utils, storage }) => {
        await utils.cursor.init('initial_run')
        const cursor = await utils.cursor.increment('initial_run')
        if (cursor === 1) {
            const maxDate = new Date(Date.now()).toISOString()
            console.log(`Starting export of historical events from ${global.startDate}`)
            await storage.set('current_max_date', maxDate)
            await jobs['Export historical events']({
                dateFrom: global.startDate,
                dateTo: maxDate,
            }).runNow()
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
