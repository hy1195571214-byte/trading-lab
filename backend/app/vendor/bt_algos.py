"""Selected unmodified bt algorithms; see README.md and LICENSE."""
import pandas as pd


class Algo:
    """Minimal stand-in for bt.core.Algo; no execution engine is imported."""
    pass


def _select_by_price(prices, candidates, include_no_data, include_negative):
    """Return labels allowed by the independent data and price-sign flags."""
    if include_no_data:
        prices = prices.reindex(candidates)
    else:
        prices = prices.loc[candidates].dropna()
    if not include_negative:
        prices = prices[prices.isna() | (prices > 0)]
    return list(prices.index)


class RunOnce(Algo):
    """
    Returns True on first run then returns False.

    Args:
        * run_on_first_call: bool which determines if it runs the first time the algo is called

    As the name says, the algo only runs once. Useful in situations
    where we want to run the logic once (buy and hold for example).

    """

    def __init__(self):
        super().__init__()
        self.has_run = False

    def __call__(self, target):
        # if it hasn't run then we will
        # run it and set flag
        if not self.has_run:
            self.has_run = True
            return True

        # return false to stop future execution
        return False


class SelectAll(Algo):
    """
    Sets temp['selected'] with all securities (based on universe).

    Selects all the securities and saves them in temp['selected'].
    By default, SelectAll does not include securities that have no
    data (nan) on current date or those whose price is zero or negative.

    Args:
        * include_no_data (bool): Include securities that do not have data?
        * include_negative (bool): Include securities that have negative
          or zero prices?
    Sets:
        * selected

    """

    def __init__(self, include_no_data=False, include_negative=False):
        super().__init__()
        self.include_no_data = include_no_data
        self.include_negative = include_negative

    def __call__(self, target):
        if self.include_no_data and self.include_negative:
            target.temp["selected"] = target.universe.columns
        else:
            prices = target.universe.loc[target.now]
            target.temp["selected"] = _select_by_price(
                prices,
                target.universe.columns,
                self.include_no_data,
                self.include_negative,
            )
        return True


class SelectWhere(Algo):
    """
    Selects securities based on an indicator DataFrame.

    Selects securities where the value is True on the current date
    (target.now). If the date is absent from the signal DataFrame, returns
    False to stop the AlgoStack. A present all-False row remains a valid empty
    selection and returns True.

    For example, this could be the result of a pandas boolean comparison such
    as data > 100.

    Warning:
        Signals derived from fundamental data are only point-in-time safe when
        the data contains values known on each historical date. Data containing
        later restatements introduces look-ahead bias. SelectWhere evaluates the
        supplied signal as-is and cannot detect or correct restated values.

    Args:
        * signal (str|DataFrame): Boolean DataFrame containing selection logic.
          If a string is passed, frame is accessed using target.get_data
          This is the preferred way of using the algo.
        * include_no_data (bool): Include securities that do not have data?
        * include_negative (bool): Include securities that have negative
          or zero prices?

    Sets:
        * selected

    """

    def __init__(self, signal, include_no_data=False, include_negative=False):
        super().__init__()
        if isinstance(signal, pd.DataFrame):
            self.signal_name = None
            self.signal = signal
        else:
            self.signal_name = signal
            self.signal = None

        self.include_no_data = include_no_data
        self.include_negative = include_negative

    def __call__(self, target):
        # get signal Series at target.now
        if self.signal_name is None:
            signal = self.signal
        else:
            signal = target.get_data(self.signal_name)

        if target.now in signal.index:
            sig = signal.loc[target.now]
            # get tickers where True
            # selected = sig.index[sig]
            selected = sig[sig == True].index
            # save as list
            prices = target.universe.loc[target.now]
            selected = _select_by_price(prices, selected, self.include_no_data, self.include_negative)
            target.temp["selected"] = list(selected)
            return True

        # Stop downstream Algos when no signal row exists for the current date.
        return False


class WeighEqually(Algo):
    """
    Sets temp['weights'] by calculating equal weights for all items in
    selected.

    Equal weight Algo. Sets the 'weights' to 1/n for each item in 'selected'.

    Sets:
        * weights

    Requires:
        * selected

    """

    def __init__(self):
        super().__init__()

    def __call__(self, target):
        selected = target.temp["selected"]
        n = len(selected)

        if n == 0:
            target.temp["weights"] = {}
        else:
            w = 1.0 / n
            target.temp["weights"] = {x: w for x in selected}

        return True

