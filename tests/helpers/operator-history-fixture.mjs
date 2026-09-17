import { execFileSync } from "node:child_process";

export function operatorHistoryFixture() {
  return JSON.parse(
    execFileSync(
      process.env.PYTHON || "python3",
      [
        "-c",
        `
import io,json
from anac_operator_awards_index import project_operator
from anac_operator_history import summarize_history
from anac_operator_history_blocks import write_blocks
rows=[('A000000001',str(i),'Impresa','2025-01-01','0','zero',1) for i in range(205)]
op=project_operator('op-00000001',rows,award_limit=None)
header={k:op[k] for k in ('ref','name','nameVariants','awardCount','yearMin','yearMax','attributedAwardCount','attributedValue')}
stream=io.BytesIO()
summary={**header,**summarize_history(op,{}),'detail':write_blocks(stream,op['ref'],op['awards'],{})}
import base64
print(json.dumps({'summary':summary,'pack':base64.b64encode(stream.getvalue()).decode()}))
`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PYTHONPATH: "scripts/etl:scripts/ci",
          DVNS_OFFLINE_GUARD: "1",
        },
      },
    ),
  );
}
