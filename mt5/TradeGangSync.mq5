//+------------------------------------------------------------------+
//|                                               TradeGangSync.mq5  |
//|   Read-only sync from MetaTrader 5 to Trade Gang on this machine. |
//|   It never sends, modifies or closes orders.                      |
//+------------------------------------------------------------------+
#property copyright   "Trade Gang"
#property version     "1.00"
#property description "Streams deals, positions, equity, candles and the economic calendar to the Trade Gang journal running on your computer."
#property description "Read-only: this EA never trades. Attach it to any one chart."

input string InpHost         = "127.0.0.1"; // Trade Gang host (this computer)
input ushort InpPort         = 3685;        // Trade Gang port
input string InpToken        = "";          // Token from Trade Gang → Settings → MT5 connection
input int    InpHeartbeatSec = 2;           // Live equity/positions every N seconds
input int    InpReconcileSec = 30;          // Re-check recent history every N seconds

#define EA_VERSION  "1.1"
#define BATCH_DEALS 200
#define BATCH_BARS  3000
#define BATCH_EVENTS 1000

// ── State
bool     g_hello       = false;
bool     g_backfilled  = false;
bool     g_busy        = false;
datetime g_since       = 0;
datetime g_lastRecon   = 0;
uint     g_lastBeat    = 0;
uint     g_lastHello   = 0;
uint     g_lastOk      = 0;
int      g_fails       = 0;
int      g_dealsSent   = 0;
int      g_tasksDone   = 0;
bool     g_badToken    = false;
string   g_status      = "Starting";
string   g_error       = "";
ulong    g_qDeals[];
ulong    g_qPositions[];
string   g_specsSent[];
long     g_login       = 0;   // account the current session was opened for
uint     g_readySince  = 0;   // when MT5 last became logged in to the broker

//+------------------------------------------------------------------+
//| Small helpers                                                     |
//+------------------------------------------------------------------+
string J(const string s)
  {
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\r", "\\r");
   StringReplace(out, "\n", "\\n");
   StringReplace(out, "\t", "\\t");
   // Drop any other control characters
   string clean = "";
   int n = StringLen(out);
   for(int i = 0; i < n; i++)
     {
      ushort c = StringGetCharacter(out, i);
      if(c >= 32)
         clean += ShortToString(c);
     }
   return "\"" + clean + "\"";
  }

string N(const double v, const int digits)
  {
   if(!MathIsValidNumber(v))
      return "0";
   return DoubleToString(v, digits);
  }

string I(const long v) { return IntegerToString(v); }

string AccountPart()
  {
   return "\"login\":" + I(AccountInfoInteger(ACCOUNT_LOGIN)) + ",\"server\":" + J(AccountInfoString(ACCOUNT_SERVER));
  }

bool Contains(const string &list[], const string v)
  {
   for(int i = 0; i < ArraySize(list); i++)
      if(list[i] == v)
         return true;
   return false;
  }

void PushTicket(ulong &list[], const ulong v)
  {
   for(int i = 0; i < ArraySize(list); i++)
      if(list[i] == v)
         return;
   int n = ArraySize(list);
   ArrayResize(list, n + 1);
   list[n] = v;
  }

int HexToInt(const string h)
  {
   int v = 0;
   for(int i = 0; i < StringLen(h); i++)
     {
      ushort c = StringGetCharacter(h, i);
      int d;
      if(c >= '0' && c <= '9')
         d = c - '0';
      else if(c >= 'a' && c <= 'f')
         d = c - 'a' + 10;
      else if(c >= 'A' && c <= 'F')
         d = c - 'A' + 10;
      else
         break;
      v = v * 16 + d;
     }
   return v;
  }

//+------------------------------------------------------------------+
//| Minimal HTTP/1.0 client over MQL5 sockets.                        |
//| WebRequest only allows ports 80/443, so we speak HTTP ourselves.  |
//| Returns the HTTP status (or -1) and fills `lines` with the reply. |
//+------------------------------------------------------------------+
int Post(const string path, const string body, string &lines[])
  {
   ArrayResize(lines, 0);
   int sock = SocketCreate();
   if(sock == INVALID_HANDLE)
     {
      g_error = "SocketCreate failed (" + I(GetLastError()) + ")";
      return -1;
     }
   if(!SocketConnect(sock, InpHost, InpPort, 3000))
     {
      int err = GetLastError();
      if(err == 4014)
         g_error = "Add http://" + InpHost + " to Tools > Options > Expert Advisors > Allow WebRequest for listed URL";
      else
         g_error = "Can't reach Trade Gang at " + InpHost + ":" + I(InpPort) + " - is the app running? (" + I(err) + ")";
      SocketClose(sock);
      return -1;
     }

   uchar payload[];
   int n = StringToCharArray(body, payload, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0)
      ArrayResize(payload, n - 1); // drop the terminating NUL
   string head = "POST " + path + " HTTP/1.0\r\n"
                 + "Host: " + InpHost + ":" + I(InpPort) + "\r\n"
                 + "Content-Type: application/json\r\n"
                 + "X-TG-Token: " + InpToken + "\r\n"
                 + "User-Agent: TradeGangSync/" + EA_VERSION + "\r\n"
                 + "Content-Length: " + I(ArraySize(payload)) + "\r\n"
                 + "Connection: close\r\n\r\n";
   uchar req[];
   int hn = StringToCharArray(head, req, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(req, hn - 1);
   ArrayCopy(req, payload, ArraySize(req));

   if(SocketSend(sock, req, ArraySize(req)) < 0)
     {
      g_error = "Send failed (" + I(GetLastError()) + ")";
      SocketClose(sock);
      return -1;
     }

   uchar all[];
   uchar buf[];
   uint deadline = GetTickCount() + 20000;
   while(GetTickCount() < deadline && !IsStopped())
     {
      uint avail = SocketIsReadable(sock);
      if(avail > 0)
        {
         int got = SocketRead(sock, buf, avail, 1000);
         if(got > 0)
            ArrayCopy(all, buf, ArraySize(all), 0, got);
         else
            break;
        }
      else
        {
         if(!SocketIsConnected(sock))
            break;
         Sleep(2);
        }
     }
   SocketClose(sock);

   string raw = CharArrayToString(all, 0, WHOLE_ARRAY, CP_UTF8);
   int split = StringFind(raw, "\r\n\r\n");
   if(split < 0)
     {
      g_error = "No reply from Trade Gang";
      return -1;
     }
   string headers = StringSubstr(raw, 0, split);
   string text = StringSubstr(raw, split + 4);

   // Status line: HTTP/1.1 200 OK
   string first[];
   StringSplit(headers, ' ', first);
   int status = ArraySize(first) > 1 ? (int)StringToInteger(first[1]) : -1;

   // The server should not chunk an HTTP/1.0 reply, but decode it just in case.
   string lower = headers;
   StringToLower(lower);
   if(StringFind(lower, "transfer-encoding: chunked") >= 0)
     {
      string decoded = "";
      int pos = 0;
      while(pos < StringLen(text))
        {
         int eol = StringFind(text, "\r\n", pos);
         if(eol < 0)
            break;
         int size = HexToInt(StringSubstr(text, pos, eol - pos));
         if(size <= 0)
            break;
         decoded += StringSubstr(text, eol + 2, size);
         pos = eol + 2 + size + 2;
        }
      text = decoded;
     }

   StringReplace(text, "\r", "");
   string parts[];
   int k = StringSplit(text, '\n', parts);
   for(int i = 0; i < k; i++)
     {
      if(StringLen(parts[i]) == 0)
         continue;
      int m = ArraySize(lines);
      ArrayResize(lines, m + 1);
      lines[m] = parts[i];
     }

   if(status == 401)
     {
      g_badToken = true;
      g_error = "Wrong token. Copy it from Trade Gang > Settings > MT5 connection.";
     }
   else if(ArraySize(lines) > 0 && StringFind(lines[0], "ERR|") == 0)
      g_error = StringSubstr(lines[0], 4);
   return status;
  }

bool Ok(const int status, const string &lines[])
  {
   bool ok = status == 200 && ArraySize(lines) > 0 && StringFind(lines[0], "OK") == 0;
   if(ok)
     {
      g_fails = 0;
      g_lastOk = GetTickCount();
      g_badToken = false;
     }
   else
      g_fails++;
   return ok;
  }

//+------------------------------------------------------------------+
//| Payloads                                                          |
//+------------------------------------------------------------------+
string SymbolSpec(const string sym)
  {
   SymbolSelect(sym, true);
   return "{\"name\":" + J(sym)
          + ",\"digits\":" + I(SymbolInfoInteger(sym, SYMBOL_DIGITS))
          + ",\"point\":" + N(SymbolInfoDouble(sym, SYMBOL_POINT), 10)
          + ",\"tickSize\":" + N(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), 10)
          + ",\"tickValue\":" + N(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE), 10)
          + ",\"contractSize\":" + N(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE), 4)
          + ",\"currencyProfit\":" + J(SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT)) + "}";
  }

// The deal must already be in the selected history (HistorySelect / HistoryDealSelect).
string DealJson(const ulong t)
  {
   string sym = HistoryDealGetString(t, DEAL_SYMBOL);
   int digits = sym == "" ? 5 : (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   if(digits <= 0)
      digits = 5;
   return "{\"ticket\":" + I((long)t)
          + ",\"order\":" + I(HistoryDealGetInteger(t, DEAL_ORDER))
          + ",\"position\":" + I(HistoryDealGetInteger(t, DEAL_POSITION_ID))
          + ",\"time\":" + I(HistoryDealGetInteger(t, DEAL_TIME))
          + ",\"timeMsc\":" + I(HistoryDealGetInteger(t, DEAL_TIME_MSC))
          + ",\"type\":" + J(EnumToString((ENUM_DEAL_TYPE)HistoryDealGetInteger(t, DEAL_TYPE)))
          + ",\"entry\":" + J(EnumToString((ENUM_DEAL_ENTRY)HistoryDealGetInteger(t, DEAL_ENTRY)))
          + ",\"reason\":" + J(EnumToString((ENUM_DEAL_REASON)HistoryDealGetInteger(t, DEAL_REASON)))
          + ",\"symbol\":" + J(sym)
          + ",\"volume\":" + N(HistoryDealGetDouble(t, DEAL_VOLUME), 2)
          + ",\"price\":" + N(HistoryDealGetDouble(t, DEAL_PRICE), digits)
          + ",\"profit\":" + N(HistoryDealGetDouble(t, DEAL_PROFIT), 2)
          + ",\"swap\":" + N(HistoryDealGetDouble(t, DEAL_SWAP), 2)
          + ",\"commission\":" + N(HistoryDealGetDouble(t, DEAL_COMMISSION), 2)
          + ",\"fee\":" + N(HistoryDealGetDouble(t, DEAL_FEE), 2)
          + ",\"sl\":" + N(HistoryDealGetDouble(t, DEAL_SL), digits)
          + ",\"tp\":" + N(HistoryDealGetDouble(t, DEAL_TP), digits)
          + ",\"magic\":" + I(HistoryDealGetInteger(t, DEAL_MAGIC))
          + ",\"comment\":" + J(HistoryDealGetString(t, DEAL_COMMENT)) + "}";
  }

// Symbol specs for any symbol in this batch the server hasn't seen this session.
string SpecsFor(const string &symbols[])
  {
   string out = "";
   for(int i = 0; i < ArraySize(symbols); i++)
     {
      if(symbols[i] == "" || Contains(g_specsSent, symbols[i]))
         continue;
      out += (out == "" ? "" : ",") + SymbolSpec(symbols[i]);
      int n = ArraySize(g_specsSent);
      ArrayResize(g_specsSent, n + 1);
      g_specsSent[n] = symbols[i];
     }
   return out;
  }

bool PostDeals(const string &items, const string &symbols[], const int count)
  {
   if(count == 0)
      return true;
   string body = "{" + AccountPart() + ",\"deals\":[" + items + "],\"symbols\":[" + SpecsFor(symbols) + "]}";
   string lines[];
   int status = Post("/api/ea/deals", body, lines);
   if(!Ok(status, lines))
     {
      ArrayResize(g_specsSent, 0); // resend specs next time
      return false;
     }
   g_dealsSent += count;
   return true;
  }

// Send every deal between two server times, in batches.
bool SendDealsRange(const datetime from, const datetime to)
  {
   if(!HistorySelect(from, to))
      return false;
   int total = HistoryDealsTotal();
   string items = "";
   string symbols[];
   int count = 0;
   for(int i = 0; i < total; i++)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0)
         continue;
      items += (count == 0 ? "" : ",") + DealJson(t);
      string sym = HistoryDealGetString(t, DEAL_SYMBOL);
      if(sym != "" && !Contains(symbols, sym))
        {
         int n = ArraySize(symbols);
         ArrayResize(symbols, n + 1);
         symbols[n] = sym;
        }
      count++;
      if(count >= BATCH_DEALS)
        {
         if(!PostDeals(items, symbols, count))
            return false;
         g_status = "Sending history " + I(i + 1) + "/" + I(total);
         ShowStatus();
         items = "";
         count = 0;
         ArrayResize(symbols, 0);
        }
     }
   return PostDeals(items, symbols, count);
  }

//+------------------------------------------------------------------+
//| Protocol steps                                                    |
//+------------------------------------------------------------------+
bool Hello()
  {
   string body = "{" + AccountPart()
                 + ",\"v\":1,\"ea\":" + J(EA_VERSION)
                 + ",\"company\":" + J(AccountInfoString(ACCOUNT_COMPANY))
                 + ",\"name\":" + J(AccountInfoString(ACCOUNT_NAME))
                 + ",\"currency\":" + J(AccountInfoString(ACCOUNT_CURRENCY))
                 + ",\"leverage\":" + I(AccountInfoInteger(ACCOUNT_LEVERAGE))
                 + ",\"marginMode\":" + J(EnumToString((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE)))
                 + ",\"tradeMode\":" + J(EnumToString((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)))
                 + ",\"balance\":" + N(AccountInfoDouble(ACCOUNT_BALANCE), 2)
                 + ",\"equity\":" + N(AccountInfoDouble(ACCOUNT_EQUITY), 2)
                 + ",\"serverTime\":" + I((long)TimeTradeServer())
                 + ",\"gmtTime\":" + I((long)TimeGMT()) + "}";
   string lines[];
   int status = Post("/api/ea/hello", body, lines);
   if(!Ok(status, lines))
      return false;
   g_since = 0;
   for(int i = 1; i < ArraySize(lines); i++)
      if(StringFind(lines[i], "since=") == 0)
         g_since = (datetime)StringToInteger(StringSubstr(lines[i], 6));
   g_error = "";
   return true;
  }

void Heartbeat()
  {
   string positions = "";
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      positions += (positions == "" ? "" : ",")
                   + "{\"ticket\":" + I((long)t)
                   + ",\"identifier\":" + I(PositionGetInteger(POSITION_IDENTIFIER))
                   + ",\"symbol\":" + J(sym)
                   + ",\"type\":" + J(EnumToString((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE)))
                   + ",\"volume\":" + N(PositionGetDouble(POSITION_VOLUME), 2)
                   + ",\"priceOpen\":" + N(PositionGetDouble(POSITION_PRICE_OPEN), digits)
                   + ",\"priceCurrent\":" + N(PositionGetDouble(POSITION_PRICE_CURRENT), digits)
                   + ",\"sl\":" + N(PositionGetDouble(POSITION_SL), digits)
                   + ",\"tp\":" + N(PositionGetDouble(POSITION_TP), digits)
                   + ",\"profit\":" + N(PositionGetDouble(POSITION_PROFIT), 2)
                   + ",\"swap\":" + N(PositionGetDouble(POSITION_SWAP), 2)
                   + ",\"time\":" + I(PositionGetInteger(POSITION_TIME)) + "}";
     }
   string body = "{" + AccountPart()
                 + ",\"serverTime\":" + I((long)TimeTradeServer())
                 + ",\"balance\":" + N(AccountInfoDouble(ACCOUNT_BALANCE), 2)
                 + ",\"equity\":" + N(AccountInfoDouble(ACCOUNT_EQUITY), 2)
                 + ",\"margin\":" + N(AccountInfoDouble(ACCOUNT_MARGIN), 2)
                 + ",\"freeMargin\":" + N(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2)
                 + ",\"profit\":" + N(AccountInfoDouble(ACCOUNT_PROFIT), 2)
                 + ",\"positions\":[" + positions + "]}";
   string lines[];
   int status = Post("/api/ea/heartbeat", body, lines);
   if(!Ok(status, lines))
      return;
   for(int i = 1; i < ArraySize(lines); i++)
      if(StringFind(lines[i], "T|") == 0)
         RunTask(lines[i]);
  }

void FlushDeals()
  {
   int n = ArraySize(g_qDeals);
   if(n == 0)
      return;
   string items = "";
   string symbols[];
   int count = 0;
   for(int i = 0; i < n; i++)
     {
      if(!HistoryDealSelect(g_qDeals[i]))
         continue;
      items += (count == 0 ? "" : ",") + DealJson(g_qDeals[i]);
      string sym = HistoryDealGetString(g_qDeals[i], DEAL_SYMBOL);
      if(sym != "" && !Contains(symbols, sym))
        {
         int m = ArraySize(symbols);
         ArrayResize(symbols, m + 1);
         symbols[m] = sym;
        }
      count++;
     }
   if(PostDeals(items, symbols, count))
      ArrayResize(g_qDeals, 0);
  }

// Stop-loss / take-profit changes on open positions (shows how you manage the stop).
void FlushPositions()
  {
   int n = ArraySize(g_qPositions);
   if(n == 0)
      return;
   bool all = true;
   for(int i = 0; i < n; i++)
     {
      if(!PositionSelectByTicket(g_qPositions[i]))
         continue; // already closed: the closing deal carries the rest
      string sym = PositionGetString(POSITION_SYMBOL);
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      string body = "{" + AccountPart()
                    + ",\"position\":" + I(PositionGetInteger(POSITION_IDENTIFIER))
                    + ",\"symbol\":" + J(sym)
                    + ",\"sl\":" + N(PositionGetDouble(POSITION_SL), digits)
                    + ",\"tp\":" + N(PositionGetDouble(POSITION_TP), digits)
                    + ",\"time\":" + I((long)TimeTradeServer()) + "}";
      string lines[];
      if(!Ok(Post("/api/ea/position", body, lines), lines))
         all = false;
     }
   if(all)
      ArrayResize(g_qPositions, 0);
  }

ENUM_TIMEFRAMES Tf(const string tf)
  {
   if(tf == "M1")  return PERIOD_M1;
   if(tf == "M5")  return PERIOD_M5;
   if(tf == "M15") return PERIOD_M15;
   if(tf == "H1")  return PERIOD_H1;
   if(tf == "H4")  return PERIOD_H4;
   if(tf == "D1")  return PERIOD_D1;
   return PERIOD_M5;
  }

void TaskCandles(const string id, const string sym, const string tf, const datetime from, const datetime to)
  {
   SymbolSelect(sym, true);
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int got = CopyRates(sym, Tf(tf), from, to, r);
   if(got < 0)
      return; // history still loading; the server asks again in a couple of minutes
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   int start = 0;
   do
     {
      int end = MathMin(got, start + BATCH_BARS);
      string bars = "";
      for(int i = start; i < end; i++)
         bars += (i == start ? "" : ",") + "[" + I((long)r[i].time) + "," + N(r[i].open, digits) + "," + N(r[i].high, digits) + "," + N(r[i].low, digits) + "," + N(r[i].close, digits) + "," + I(r[i].tick_volume) + "," + I(r[i].spread) + "]";
      string body = "{" + AccountPart() + ",\"task\":" + J(id) + ",\"symbol\":" + J(sym) + ",\"tf\":" + J(tf) + ",\"bars\":[" + bars + "]}";
      string lines[];
      if(!Ok(Post("/api/ea/candles", body, lines), lines))
         return;
      start = end;
     }
   while(start < got);
   g_tasksDone++;
  }

string Opt(const bool has, const double v) { return has ? N(v, 6) : "null"; }

void TaskCalendar(const string id, const datetime from, const datetime to, const string currencies)
  {
   string cur[];
   int nc = StringSplit(currencies, ',', cur);
   string events = "";
   int count = 0;
   bool sent = false;
   for(int c = 0; c < nc; c++)
     {
      MqlCalendarValue v[];
      int k = CalendarValueHistory(v, from, to, NULL, cur[c]);
      for(int j = 0; j < k; j++)
        {
         MqlCalendarEvent ev;
         if(!CalendarEventById(v[j].event_id, ev))
            continue;
         if(ev.importance == CALENDAR_IMPORTANCE_NONE)
            continue;
         MqlCalendarCountry co;
         string code = CalendarCountryById(ev.country_id, co) ? co.code : "";
         events += (count == 0 ? "" : ",")
                   + "{\"id\":" + I((long)v[j].id)
                   + ",\"eventId\":" + I((long)v[j].event_id)
                   + ",\"time\":" + I((long)v[j].time)
                   + ",\"currency\":" + J(cur[c])
                   + ",\"country\":" + J(code)
                   + ",\"name\":" + J(ev.name)
                   + ",\"importance\":" + J(EnumToString(ev.importance))
                   + ",\"actual\":" + Opt(v[j].HasActualValue(), v[j].GetActualValue())
                   + ",\"forecast\":" + Opt(v[j].HasForecastValue(), v[j].GetForecastValue())
                   + ",\"previous\":" + Opt(v[j].HasPreviousValue(), v[j].GetPreviousValue()) + "}";
         count++;
         if(count >= BATCH_EVENTS)
           {
            string lines[];
            if(!Ok(Post("/api/ea/calendar", "{" + AccountPart() + ",\"task\":" + J(id) + ",\"events\":[" + events + "]}", lines), lines))
               return;
            sent = true;
            events = "";
            count = 0;
           }
        }
     }
   if(count > 0 || !sent)
     {
      string lines[];
      if(!Ok(Post("/api/ea/calendar", "{" + AccountPart() + ",\"task\":" + J(id) + ",\"events\":[" + events + "]}", lines), lines))
         return;
     }
   g_tasksDone++;
  }

void RunTask(const string line)
  {
   string p[];
   int n = StringSplit(line, '|', p);
   if(n < 3)
      return;
   string id = p[1];
   string kind = p[2];
   if(kind == "CANDLES" && n >= 7)
     {
      g_status = "Sending " + p[3] + " " + p[4] + " candles";
      ShowStatus();
      TaskCandles(id, p[3], p[4], (datetime)StringToInteger(p[5]), (datetime)StringToInteger(p[6]));
     }
   else if(kind == "CALENDAR" && n >= 5)
     {
      g_status = "Sending economic calendar";
      ShowStatus();
      TaskCalendar(id, (datetime)StringToInteger(p[3]), (datetime)StringToInteger(p[4]), n >= 6 ? p[5] : "USD,EUR,GBP,JPY");
     }
   else if(kind == "HISTORY" && n >= 4)
     {
      if(SendDealsRange((datetime)StringToInteger(p[3]), TimeTradeServer() + 86400))
         g_tasksDone++;
     }
  }

//+------------------------------------------------------------------+
//| Chart status                                                      |
//+------------------------------------------------------------------+
void ShowStatus()
  {
   string live = g_lastOk > 0 && GetTickCount() - g_lastOk < (uint)(InpHeartbeatSec * 1000 * 4) ? "Live" : "Not connected";
   string s = "Trade Gang Sync " + EA_VERSION + "  (read-only, never trades)\n"
              + "Server: " + InpHost + ":" + I(InpPort) + "   " + live + "\n"
              + "Status: " + g_status + "\n"
              + "Deals sent: " + I(g_dealsSent) + "   Tasks done: " + I(g_tasksDone);
   if(g_error != "")
      s += "\nLast problem: " + g_error;
   Comment(s);
  }

//+------------------------------------------------------------------+
//| Event handlers                                                    |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(InpToken) < 8)
     {
      Comment("Trade Gang Sync: paste your token in the EA inputs (Trade Gang > Settings > MT5 connection).");
      return INIT_PARAMETERS_INCORRECT;
     }
   EventSetTimer(1);
   g_status = "Connecting";
   ShowStatus();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   // Only remember what changed; the timer sends it, so trading is never slowed down.
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD && trans.deal > 0)
      PushTicket(g_qDeals, trans.deal);
   else if(trans.type == TRADE_TRANSACTION_POSITION && trans.position > 0)
      PushTicket(g_qPositions, trans.position);
  }

// MT5 is logged in to the broker and knows the account. Until then the balance reads 0 and the
// history is empty, so nothing is sent (sending it would look like an empty account).
bool BrokerReady()
  {
   return TerminalInfoInteger(TERMINAL_CONNECTED) && AccountInfoInteger(ACCOUNT_LOGIN) > 0 && AccountInfoString(ACCOUNT_CURRENCY) != "";
  }

void OnTimer()
  {
   if(g_busy)
      return;
   g_busy = true;
   uint now = GetTickCount();

   if(!BrokerReady())
     {
      g_readySince = 0;
      g_hello = false;   // say hello and backfill again once logged in
      g_status = "Waiting for MT5 to log in to the broker (File > Login to Trade Account)";
      ShowStatus();
      g_busy = false;
      return;
     }
   if(g_readySince == 0)
      g_readySince = now;
   // A different account was logged in: start a fresh session for it.
   long login = AccountInfoInteger(ACCOUNT_LOGIN);
   if(login != g_login)
     {
      g_login = login;
      g_hello = false;
      ArrayResize(g_specsSent, 0);
     }
   // Give the terminal a moment to download the account history after logging in.
   if(now - g_readySince < 5000)
     {
      g_status = "Logged in, loading history";
      ShowStatus();
      g_busy = false;
      return;
     }

   // A wrong token: retry slowly so the user can fix it in Settings.
   uint helloEvery = g_badToken ? 30000 : 5000;

   if(!g_hello)
     {
      if(g_lastHello == 0 || now - g_lastHello >= helloEvery)
        {
         g_lastHello = now;
         g_status = "Connecting";
         if(Hello())
           {
            g_hello = true;
            g_backfilled = false;
           }
        }
     }
   else if(!g_backfilled)
     {
      g_status = "Sending history since " + TimeToString(g_since, TIME_DATE | TIME_MINUTES);
      ShowStatus();
      datetime to = TimeTradeServer() + 86400;
      if(SendDealsRange(g_since, to))
        {
         g_backfilled = true;
         g_lastRecon = TimeTradeServer();
         g_status = "Live";
        }
     }
   else
     {
      FlushDeals();
      FlushPositions();
      if(now - g_lastBeat >= (uint)(MathMax(1, InpHeartbeatSec) * 1000))
        {
         g_lastBeat = now;
         Heartbeat();
         if(g_status != "Live" && g_fails == 0)
            g_status = "Live";
        }
      datetime srv = TimeTradeServer();
      if(srv - g_lastRecon >= MathMax(10, InpReconcileSec))
        {
         // Catch anything a missed transaction event left behind; the server ignores duplicates.
         if(SendDealsRange(g_lastRecon - 3600, srv + 86400))
            g_lastRecon = srv;
        }
      // Several failures in a row (app restarted?): say hello again.
      if(g_fails >= 5)
        {
         g_hello = false;
         g_fails = 0;
         g_status = "Reconnecting";
        }
     }
   ShowStatus();
   g_busy = false;
  }
//+------------------------------------------------------------------+
