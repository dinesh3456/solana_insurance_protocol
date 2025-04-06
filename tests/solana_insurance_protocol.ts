import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaInsuranceProtocol } from "../target/types/solana_insurance_protocol";
import { TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { assert } from "chai";

describe("solana-insurance-protocol", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaInsuranceProtocol as Program<SolanaInsuranceProtocol>;
  
  // Test accounts
  const admin = anchor.web3.Keypair.generate();
  const protocol = anchor.web3.Keypair.generate();
  const insured = anchor.web3.Keypair.generate();
  const capitalProvider = anchor.web3.Keypair.generate();
  
  // PDAs
  let protocolStatePda: PublicKey;
  let protocolRegistryPda: PublicKey;
  let protocolInfoPda: PublicKey;
  let capitalPoolPda: PublicKey;
  
  // SPL Token mint and accounts
  let mint: Token;
  let insuredTokenAccount: PublicKey;
  let treasuryTokenAccount: PublicKey;
  let poolTokenAccount: PublicKey;
  let providerTokenAccount: PublicKey;
  
  const POOL_TYPE_MEDIUM_RISK = 2;

  before(async () => {
    // Airdrop SOL to test accounts
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(admin.publicKey, 100 * LAMPORTS_PER_SOL),
      "confirmed"
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(insured.publicKey, 10 * LAMPORTS_PER_SOL),
      "confirmed"
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(protocol.publicKey, 10 * LAMPORTS_PER_SOL),
      "confirmed"
    );
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(capitalProvider.publicKey, 10 * LAMPORTS_PER_SOL),
      "confirmed"
    );
    
    // Create PDAs
    [protocolStatePda] = await PublicKey.findProgramAddress(
      [Buffer.from("protocol-state")],
      program.programId
    );
    
    [protocolRegistryPda] = await PublicKey.findProgramAddress(
      [Buffer.from("protocol-registry")],
      program.programId
    );
    
    [protocolInfoPda] = await PublicKey.findProgramAddress(
      [Buffer.from("protocol-info"), protocol.publicKey.toBuffer()],
      program.programId
    );
    
    [capitalPoolPda] = await PublicKey.findProgramAddress(
      [Buffer.from("capital-pool"), Buffer.from([POOL_TYPE_MEDIUM_RISK])],
      program.programId
    );
    
    // Create SPL token mint
    mint = await Token.createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6, // 6 decimals
      TOKEN_PROGRAM_ID
    );
    
    // Create token accounts
    insuredTokenAccount = await mint.createAccount(insured.publicKey);
    treasuryTokenAccount = await mint.createAccount(admin.publicKey);
    poolTokenAccount = await mint.createAccount(capitalPoolPda);
    providerTokenAccount = await mint.createAccount(capitalProvider.publicKey);
    
    // Mint tokens to users
    await mint.mintTo(
      insuredTokenAccount,
      admin.publicKey,
      [],
      1000 * 1000000 // 1000 tokens with 6 decimals
    );
    
    await mint.mintTo(
      providerTokenAccount,
      admin.publicKey,
      [],
      10000 * 1000000 // 10000 tokens with 6 decimals
    );
  });
  
  it("Initializes the protocol", async () => {
    // Initialize the protocol
    await program.methods
      .initialize(new anchor.BN(500)) // 5% protocol fee (500 basis points)
      .accounts({
        authority: admin.publicKey,
        protocolState: protocolStatePda,
        registry: protocolRegistryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    // Fetch and check the protocol state
    const protocolState = await program.account.protocolState.fetch(protocolStatePda);
    assert.equal(protocolState.authority.toString(), admin.publicKey.toString());
    assert.equal(protocolState.protocolFee.toString(), "500");
  });
  
  it("Registers a protocol", async () => {
    await program.methods
      .registerProtocol("Test Protocol", new anchor.BN(10000000)) // $10M TVL
      .accounts({
        authority: protocol.publicKey,
        protocolInfo: protocolInfoPda,
        registry: protocolRegistryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([protocol])
      .rpc();
    
    // Fetch and check the protocol info
    const protocolInfo = await program.account.protocolInfo.fetch(protocolInfoPda);
    assert.equal(protocolInfo.protocolName, "Test Protocol");
    assert.equal(protocolInfo.tvlUsd.toString(), "10000000");
    assert.equal(protocolInfo.isActive, true);
    
    // Check registry was updated
    const registry = await program.account.protocolRegistry.fetch(protocolRegistryPda);
    assert.equal(registry.protocolCount.toString(), "1");
  });
  
  it("Updates protocol risk assessment", async () => {
    const codeRiskParams = {
      auditCount: 2,
      bugBountySize: new anchor.BN(250000),
      complexityScore: 50,
    };
    
    const economicRiskParams = {
      liquidityDepth: new anchor.BN(5000000),
      concentrationRisk: 30,
    };
    
    const operationalRiskParams = {
      governanceCount: 5,
      adminCount: 3,
      oracleDependency: true,
    };
    
    await program.methods
      .updateProtocolRisk(codeRiskParams, economicRiskParams, operationalRiskParams)
      .accounts({
        authority: protocol.publicKey,
        protocolInfo: protocolInfoPda,
        protocolState: protocolStatePda,
      })
      .signers([protocol])
      .rpc();
    
    // Fetch and check the updated risk score
    const protocolInfo = await program.account.protocolInfo.fetch(protocolInfoPda);
    assert(protocolInfo.riskScore > 0 && protocolInfo.riskScore <= 100);
    console.log("Updated risk score:", protocolInfo.riskScore);
  });
  
  it("Initializes a capital pool", async () => {
    await program.methods
      .initializeCapitalPool(POOL_TYPE_MEDIUM_RISK, new anchor.BN(300)) // 3% yield rate
      .accounts({
        authority: admin.publicKey,
        capitalPool: capitalPoolPda,
        tokenMint: mint.publicKey,
        poolTokenAccount: poolTokenAccount,
        protocolState: protocolStatePda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();
    
    // Fetch and check the capital pool
    const capitalPool = await program.account.capitalPool.fetch(capitalPoolPda);
    assert.equal(capitalPool.poolType, POOL_TYPE_MEDIUM_RISK);
    assert.equal(capitalPool.yieldRateBps.toString(), "300");
    assert.equal(capitalPool.tokenMint.toString(), mint.publicKey.toString());
    assert.equal(capitalPool.tokenAccount.toString(), poolTokenAccount.toString());
  });
  
  let policyPda: PublicKey;
  
  it("Creates an insurance policy", async () => {
    [policyPda] = await PublicKey.findProgramAddress(
      [Buffer.from("policy"), insured.publicKey.toBuffer(), protocolInfoPda.toBuffer()],
      program.programId
    );
    
    const coverageAmount = new anchor.BN(100 * 1000000); // 100 tokens
    const premiumAmount = new anchor.BN(5 * 1000000);    // 5 tokens
    const durationDays = 30;
    
    await program.methods
      .createPolicy(coverageAmount, premiumAmount, durationDays)
      .accounts({
        insured: insured.publicKey,
        policy: policyPda,
        protocolInfo: protocolInfoPda,
        insuredToken: insuredTokenAccount,
        treasuryToken: treasuryTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([insured])
      .rpc();
    
    // Fetch and check the policy
    const policy = await program.account.policy.fetch(policyPda);
    assert.equal(policy.insured.toString(), insured.publicKey.toString());
    assert.equal(policy.protocol.toString(), protocolInfoPda.toString());
    assert.equal(policy.coverageAmount.toString(), coverageAmount.toString());
    assert.equal(policy.premiumAmount.toString(), premiumAmount.toString());
    assert.equal(policy.isActive, true);
    assert.equal(policy.isClaimed, false);
    
    // Check that premium was transferred
    const treasuryBalance = await provider.connection.getTokenAccountBalance(treasuryTokenAccount);
    assert.equal(treasuryBalance.value.amount, premiumAmount.toString());
  });
  
  it("Allows capital providers to provide capital", async () => {
    const [capitalProviderPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("capital-provider"), 
        capitalProvider.publicKey.toBuffer(),
        capitalPoolPda.toBuffer()
      ],
      program.programId
    );
    
    const capitalAmount = new anchor.BN(1000 * 1000000); // 1000 tokens
    
    await program.methods
      .provideCapital(capitalAmount)
      .accounts({
        owner: capitalProvider.publicKey,
        capitalProvider: capitalProviderPda,
        capitalPool: capitalPoolPda,
        providerToken: providerTokenAccount,
        poolTokenAccount: poolTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([capitalProvider])
      .rpc();
    
    // Fetch and check the capital provider
    const capitalProviderAccount = await program.account.capitalProvider.fetch(capitalProviderPda);
    assert.equal(capitalProviderAccount.owner.toString(), capitalProvider.publicKey.toString());
    assert.equal(capitalProviderAccount.capitalAmount.toString(), capitalAmount.toString());
    
    // Fetch and check the capital pool
    const capitalPool = await program.account.capitalPool.fetch(capitalPoolPda);
    assert.equal(capitalPool.totalCapital.toString(), capitalAmount.toString());
    assert.equal(capitalPool.availableCapital.toString(), capitalAmount.toString());
    
    // Check pool token account balance
    const poolBalance = await provider.connection.getTokenAccountBalance(poolTokenAccount);
    assert.equal(poolBalance.value.amount, capitalAmount.toString());
  });
  
  let claimPda: PublicKey;
  
  it("Allows insured to submit a claim", async () => {
    [claimPda] = await PublicKey.findProgramAddress(
      [Buffer.from("claim"), policyPda.toBuffer()],
      program.programId
    );
    
    const claimAmount = new anchor.BN(50 * 1000000); // 50 tokens
    const evidence = "Protocol XYZ was hacked on 2023-05-15. Transaction hash: 0x123...";
    
    await program.methods
      .submitClaim(claimAmount, evidence)
      .accounts({
        claimant: insured.publicKey,
        policy: policyPda,
        claim: claimPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([insured])
      .rpc();
    
    // Fetch and check the claim
    const claim = await program.account.claim.fetch(claimPda);
    assert.equal(claim.policy.toString(), policyPda.toString());
    assert.equal(claim.claimant.toString(), insured.publicKey.toString());
    assert.equal(claim.amount.toString(), claimAmount.toString());
    assert.equal(claim.evidence, evidence);
    assert.equal(claim.status, 0); // PENDING
  });
  
  it("Resolves a claim", async () => {
    const resolutionNotes = "Verified hack on specified date. Approving claim.";
    
    await program.methods
      .resolveClaim(true, resolutionNotes) // true = approve
      .accounts({
        resolver: admin.publicKey,
        claim: claimPda,
        policy: policyPda,
        protocolInfo: protocolInfoPda,
        capitalPool: capitalPoolPda,
        poolTokenAccount: poolTokenAccount,
        claimantToken: insuredTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();
    
    // Fetch and check the claim
    const claim = await program.account.claim.fetch(claimPda);
    assert.equal(claim.status, 1); // APPROVED
    assert.equal(claim.resolutionNotes, resolutionNotes);
    assert.equal(claim.resolver.toString(), admin.publicKey.toString());
    
    // Fetch and check the policy
    const policy = await program.account.policy.fetch(policyPda);
    assert.equal(policy.isClaimed, true);
    
    // Check insured token account balance (should have received claim amount)
    const insuredBalance = await provider.connection.getTokenAccountBalance(insuredTokenAccount);
    assert.equal(
      insuredBalance.value.amount, 
      (1000 * 1000000 - 5 * 1000000 + 50 * 1000000).toString()
    ); // Initial - premium + claim
  });
  
  it("Creates an exploit alert", async () => {
    const anomalyType = 1; // TVL drop
    const severity = 85; // High severity
    const details = "TVL dropped by 50% in 1 hour. Possible exploit in progress.";
    
    const [exploitAlertPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("exploit-alert"), 
        protocolInfoPda.toBuffer(),
        Buffer.from(new anchor.BN(Date.now()).toArray("le", 8))
      ],
      program.programId
    );
    
    await program.methods
      .createExploitAlert(anomalyType, severity, details)
      .accounts({
        authority: admin.publicKey,
        exploitAlert: exploitAlertPda,
        protocolInfo: protocolInfoPda,
        protocolState: protocolStatePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    
    // Fetch and check the exploit alert
    const exploitAlert = await program.account.exploitAlert.fetch(exploitAlertPda);
    assert.equal(exploitAlert.protocol.toString(), protocolInfoPda.toString());
    assert.equal(exploitAlert.anomalyType, anomalyType);
    assert.equal(exploitAlert.severity, severity);
    assert.equal(exploitAlert.details, details);
    assert.equal(exploitAlert.isConfirmed, false);
  });
  
  it("Allows capital provider to withdraw capital with rewards", async () => {
    // For testing, we'll fast-forward time by using calculated rewards instead of waiting
    const [capitalProviderPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from("capital-provider"), 
        capitalProvider.publicKey.toBuffer(),
        capitalPoolPda.toBuffer()
      ],
      program.programId
    );
    
    // Only withdraw half to test partial withdrawal
    const withdrawAmount = new anchor.BN(400 * 1000000); // 400 tokens
    
    await program.methods
      .withdrawCapital(withdrawAmount)
      .accounts({
        owner: capitalProvider.publicKey,
        capitalProvider: capitalProviderPda,
        capitalPool: capitalPoolPda,
        providerToken: providerTokenAccount,
        poolTokenAccount: poolTokenAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([capitalProvider])
      .rpc();
    
    // Fetch and check the capital provider
    const capitalProviderAccount = await program.account.capitalProvider.fetch(capitalProviderPda);
    assert.equal(
      capitalProviderAccount.capitalAmount.toString(), 
      new anchor.BN(600 * 1000000).toString()
    );
    
    // Fetch and check the capital pool
    const capitalPool = await program.account.capitalPool.fetch(capitalPoolPda);
    assert.equal(
      capitalPool.totalCapital.toString(), 
      new anchor.BN(600 * 1000000).toString()
    );
    
    // Check provider token account balance
    const providerBalance = await provider.connection.getTokenAccountBalance(providerTokenAccount);
    assert(
      Number(providerBalance.value.amount) >= 
      10000 * 1000000 - 1000 * 1000000 + 400 * 1000000
    );
  });
});