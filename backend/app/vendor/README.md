# Vendored bt components

`bt_algos.py` copies `_select_by_price`, `RunOnce`, `SelectAll`, `SelectWhere`,
and `WeighEqually` unchanged from [bt/algos.py at commit
0c8f521fa19704392ee182bf838b42607e236c5e](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/bt/algos.py).
The surrounding module is reduced to pandas and a minimal `Algo` base shim;
no bt execution or account engine is included. The original MIT license and
copyright notice are preserved in `LICENSE.bt`.

The [upstream SMA example](https://github.com/pmorissette/bt/blob/0c8f521fa19704392ee182bf838b42607e236c5e/docs/source/examples-nb.md)
constructs `data > data.rolling(50).mean()`, selects and equally weights. The
adapter computes pandas rolling means from each symbol's valid completed bars
and passes the signal to the actual copied `SelectWhere` and `WeighEqually`.
Compared with the example's shared-row rolling window, missing observations are
skipped in the 50-observation history; a missing current bar cannot be
selected. Daily input uses 50 daily bars; intraday input uses 50 complete bars
at the dataset interval. Warmup can only use bars in the visible snapshot.

The same example's `RunOnce -> SelectAll -> WeighEqually` is reused for
buy-and-hold; a persisted first successful decision replaces `RunOnce`'s
in-memory flag. The first scheduled decision consumes the opportunity even
when no current price is available; there is no later retry. Subsequent HOLD
retains actual shares rather than restoring equal weights. This is distinct
from the separately named upstream example which rebalances monthly.

The adapter caps equal targets by per-position, maximum gross and minimum cash
limits and leaves the remainder in cash. It never calls `Rebalance`: Lab's
executor and risk checks determine next-eligible-open fills, costs, missing
market handling and account state. An omitted holding is a zero target, not a
claim of a fill. Outputs may differ from bt's original same-price backtest.

For the local acceptance environment, the fixed `requirements.txt` versions
were sourced by copying the existing Python 3.11 packages and their distribution
metadata from this machine's Homebrew installation into the isolated
`/private/tmp/deepseek-acceptance-venv`. They were not fetched from the network.
Imports and the synthetic strategy tests ran directly from that environment.
Normal installations can use the declared dependency versions instead.
