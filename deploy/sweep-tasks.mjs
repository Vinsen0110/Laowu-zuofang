// Every few minutes: settle generation tasks nobody is watching (refunds failed or stuck ones).
//   sudo -u laowu bash -c 'cd /srv/laowu/app && set -a && . /etc/laowu/laowu.env && node deploy/sweep-tasks.mjs'
import { getDatabase } from "../account/db.js";
import { sweepTasks } from "../account/task-sweeper.js";

const summary = await sweepTasks(await getDatabase());
if (summary.checked) console.log(JSON.stringify(summary));
process.exit(0);
