## Verdict

Flow 1 is ready for an operator-controlled trial using the dedicated,
deliberately low-value testing wallet.

- Running without `YMAX_FLOW1_DEPOSIT_USDC` fails safely before I/O.
- The dedicated `ymax-flow1` PinchTab profile is headed, has MetaMask loaded,
  and now allows the branch-preview hostname used by Flow 1.
- All PinchTab tests pass. The YMax and MetaMask transaction orchestration is
  mocked, so the first live run remains an integration test.
- The operator accepts the possibility of partial durable state and will limit
  the funds exposed through the testing profile.

## Review findings and dispositions

1. **Generic MetaMask auto-approval — accepted with operator controls.**

   The driver approves recognized MetaMask actions associated with the expected
   YMax hostname. It does not validate transaction amounts, spenders, contract
   methods, or gas. This is acceptable for the automated testing/recording
   harness because the operator is responsible for ensuring that the dedicated
   wallet contains only funds they accept putting at risk. This responsibility
   is now explicit in [`README.md`](./README.md).

2. **No final human checkpoint — intentional.**

   Fully automated execution and recording is the purpose of Flow 1. Setting
   `YMAX_FLOW1_DEPOSIT_USDC` authorizes the run; the absence of a later operator
   checkpoint is already documented.

3. **Branch-preview UI allowlist mismatch — resolved.**

   Flow 1 intentionally uses
   `staging-agentic-ui.ymax0-ui.pages.dev`. The hostname was added to
   [`config.example.json`](./config.example.json) and to the live `ymax-flow1`
   profile. The dedicated instance was restarted and verified healthy with
   MetaMask loaded and no pending notification.

4. **Delegate sponsor spending — accepted.**

   Creating a delegate may spend 20 BLD plus fees. The sponsor has ample funds,
   and repeated provisioning costs are acceptable for this testing work.

5. **Existing wallet account/balance is not validated in code — accepted.**

   The operator is responsible for selecting and funding the dedicated testing
   profile. Automating reliable wallet balance and account validation is not
   currently considered worthwhile.

6. **Proposal validation is syntactic rather than semantic — deferred.**

   The URL validator checks origin, path, allocation total and count, delegate
   address shape, and allocation permission. It does not independently validate
   current instrument membership or bind `accountHolder` to MCP state. Gather
   evidence from a live run before adding more validation.

7. **Completion detection can false-positive — accepted.**

   Completion may be inferred from another same-origin YMax page. This is an
   acceptable risk for the dedicated testing profile.

8. **Claude's delegated allocation authority — intentional; prior finding withdrawn.**

   Giving Claude access to the delegated allocation tools is the point of the
   system under test. Flow 1 provisions the delegate, creates the portfolio,
   redeems the invitation, and verifies allocation authority. Its prompt asks
   Claude not to exercise that authority during this particular flow; later
   flows test mandate changes and live delegated allocation actions. The MCP
   tool surface remains available throughout.

   The original blanket instruction not to submit transactions was ambiguous
   because delegate funding and provisioning require agent-side transactions.
   It now permits transactions needed to prepare the delegate while reserving
   portfolio creation and other owner-wallet actions for the browser driver.

9. **Partial failure leaves durable state — accepted.**

   A failure can leave a funded delegate, created portfolio, or unredeemed
   invitation. This is an acknowledged drawback of the live integration test.
   Review the resulting MCP state and on-chain state before rerunning after a
   partial failure.

## Useful evidence from the first live run

Capture enough information to diagnose failures without turning these into
preconditions:

- Claude session ID and MCP tool sequence;
- validated proposal URL and rendered allocation;
- number and order of MetaMask requests;
- point of failure, if any;
- resulting delegate, portfolio, invitation, and redemption state; and
- funds remaining in the owner testing wallet and sponsor account.
