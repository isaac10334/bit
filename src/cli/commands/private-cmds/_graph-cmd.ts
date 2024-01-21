import { graph } from '../../../api/scope';
import { checkVersionCompatibilityOnTheServer } from '../../../scope/network/check-version-compatibility';
import { buildCommandMessage, fromBase64, packCommand, unpackCommand } from '../../../utils';
import clientSupportCompressedCommand from '../../../utils/ssh/client-support-compressed-command';
import { LegacyCommand } from '../../legacy-command';

let compressResponse;
export default class _Graph implements LegacyCommand {
  name = '_graph <path> <args>';
  private = true;
  internal = true;
  description = 'returns scope graph or sub-graph when component id is given';
  alias = '';
  opts = [];

  action([path, args]: [string, string]): Promise<any> {
    const { payload, headers } = unpackCommand(args);
    compressResponse = clientSupportCompressedCommand(headers.version);
    checkVersionCompatibilityOnTheServer(headers.version);
    const scopePath = fromBase64(path);
    return graph(scopePath, payload);
  }

  report(str: string): string {
    return packCommand(buildCommandMessage(str, undefined, compressResponse), true, compressResponse);
  }
}
