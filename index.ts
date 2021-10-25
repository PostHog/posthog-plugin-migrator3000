import { Plugin } from '@posthog/plugin-scaffold'
import fetch from 'node-fetch'

export interface Migrator3000MetaInput {
    config: {
        host: string
        project_api_key: string
    }
}

const ONE_DAY = 1000 * 60 * 60 * 24

interface MigrateEventsJobPayload {
    'Start date': string
}

const plugin: Plugin<Migrator3000MetaInput> = {
    jobs: {
        'Migrate events to a new instance': async (payload: MigrateEventsJobPayload, { jobs, storage }) => {
            const cutoffDateExists = await storage.get('cutoff_date', null)
            if (cutoffDateExists) {
                console.log('Only one migration job can run at a time')
                return
            }
            const cutoffDate = new Date(Date.now() + ONE_DAY * 2).toISOString()
            await storage.set('cutoff_date', cutoffDate)
            await jobs['Export historical events']({
                dateFrom: payload['Start date'],
                dateTo: cutoffDate,
            }).runNow()
        },
    },
    setupPlugin: async ({ storage }) => {
        await storage.set('block_live_export', true)
    },
    exportEvents: async (events, { config, storage }) => {
        const batch = []
        for (const event of events) {
            const isLiveExportBlocked = await storage.get('block_live_export', false)
            const timestamp = new Date(event.timestamp || Date.now())
            const cutoffDate = await storage.get('cutoff_date', null)

            if (cutoffDate && timestamp > new Date(String(cutoffDate))) {
                await storage.set('block_live_export', false)
                await storage.del('cutoff_date')
                console.log('now coming to you liveeeeeee')
            } else if (event.uuid && isLiveExportBlocked) {
                return
            }


            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { team_id, now, offset, sent_at, $token, project_id, api_key, ...sendableEvent } = {
                ...event,
                token: config.project_api_key,
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
