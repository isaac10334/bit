import { Command, CommandOptions } from '@teambit/cli';
// import { Logger } from '@teambit/logger';
import chalk from 'chalk';
import { CLITable } from '@teambit/cli-table';
import { ApplicationMain } from './application.main.runtime';

export class AppListCmd implements Command {
  name = 'app-list';
  description = 'list all registered applications';
  alias = '';
  group = 'apps';
  options = [['j', 'json', 'return the component data in json format']] as CommandOptions;

  constructor(private applicationAspect: ApplicationMain) {}

  async report(args: [string], { json }: { json: boolean }) {
    const apps = this.applicationAspect.listApps();
    if (json) return JSON.stringify(apps, null, 2);
    if (!apps.length) return chalk.yellow('no apps found');

    const rows = apps.map((app) => {
      return [app.name];
    });

    const table = new CLITable([], rows);
    return table.render();
  }
}
