/*
 * Lab Assignment 10: impact of co-channel interference on an 802.11b link.
 *
 *   n0 (TX-A) ----L---- n1 (RX-B) ----d---- n2 (TX-C) ----L---- n3 (RX-D)
 *   |<---- primary link ---->|              |<--- interfering link --->|
 *
 * Primary flow: n0 -> n1 (UDP, port 9)
 * Interfering flow: n2 -> n3 (UDP, port 10), switched on with --interf=1
 * d (distance between primary receiver and interfering transmitter) is swept.
 */
#include "ns3/applications-module.h"
#include "ns3/core-module.h"
#include "ns3/flow-monitor-module.h"
#include "ns3/internet-module.h"
#include "ns3/mobility-module.h"
#include "ns3/network-module.h"
#include "ns3/wifi-module.h"

#include <iomanip>
#include <iostream>

using namespace ns3;

NS_LOG_COMPONENT_DEFINE("WifiInterferenceLab");

static uint32_t g_retries = 0;    // failed data attempts at TX-A (no ACK)
static uint32_t g_finalFail = 0;  // frames discarded by TX-A after retry limit

static void
TxDataFailed(Mac48Address)
{
    g_retries++;
}

static void
TxFinalFailed(Mac48Address)
{
    g_finalFail++;
}

int
main(int argc, char* argv[])
{
    double linkDist = 30.0;     // m, TX-A to RX-B and TX-C to RX-D
    double interfDist = 50.0;   // m, RX-B to TX-C
    bool interf = true;         // enable the interfering pair
    double simTime = 10.0;      // s
    uint32_t pktSize = 1024;    // bytes
    double primaryInt = 0.002;  // s between primary packets  (~4 Mbit/s)
    double interfInt = 0.001;   // s between interferer packets (~8 Mbit/s, saturating)
    double rxSens = -82.0;      // dBm, receiver sensitivity / carrier sense
    bool pcap = false;
    bool verbose = false;
    uint32_t run = 1;

    CommandLine cmd(__FILE__);
    cmd.AddValue("linkDist", "TX to RX distance of each pair (m)", linkDist);
    cmd.AddValue("interfDist", "Distance RX-B to TX-C (m)", interfDist);
    cmd.AddValue("interf", "Enable interfering transmission", interf);
    cmd.AddValue("simTime", "Simulation time (s)", simTime);
    cmd.AddValue("pktSize", "UDP payload size (bytes)", pktSize);
    cmd.AddValue("primaryInt", "Primary inter-packet interval (s)", primaryInt);
    cmd.AddValue("interfInt", "Interferer inter-packet interval (s)", interfInt);
    cmd.AddValue("rxSens", "PHY RxSensitivity (dBm)", rxSens);
    cmd.AddValue("pcap", "Write PCAP traces", pcap);
    cmd.AddValue("verbose", "Print a readable summary", verbose);
    cmd.AddValue("run", "RNG run number", run);
    cmd.Parse(argc, argv);

    RngSeedManager::SetSeed(7);
    RngSeedManager::SetRun(run);

    // ---- 1. Nodes: two transmitter/receiver pairs ---------------------------
    NodeContainer nodes;
    nodes.Create(4); // 0 = TX-A, 1 = RX-B, 2 = TX-C, 3 = RX-D

    // ---- 2. 802.11b PHY + MAC (ad hoc, fixed 11 Mbit/s) ---------------------
    YansWifiChannelHelper channel;
    channel.SetPropagationDelay("ns3::ConstantSpeedPropagationDelayModel");
    channel.AddPropagationLoss("ns3::LogDistancePropagationLossModel",
                               "Exponent", DoubleValue(3.0),
                               "ReferenceLoss", DoubleValue(40.046)); // 2.4 GHz @ 1 m

    YansWifiPhyHelper phy;
    phy.SetChannel(channel.Create());
    phy.Set("TxPowerStart", DoubleValue(16.0));
    phy.Set("TxPowerEnd", DoubleValue(16.0));
    phy.Set("RxSensitivity", DoubleValue(rxSens));
    phy.SetPcapDataLinkType(WifiPhyHelper::DLT_IEEE802_11_RADIO);

    WifiHelper wifi;
    wifi.SetStandard(WIFI_STANDARD_80211b);
    wifi.SetRemoteStationManager("ns3::ConstantRateWifiManager",
                                 "DataMode", StringValue("DsssRate11Mbps"),
                                 "ControlMode", StringValue("DsssRate1Mbps"));

    WifiMacHelper mac;
    mac.SetType("ns3::AdhocWifiMac");
    NetDeviceContainer devices = wifi.Install(phy, mac, nodes);

    // ---- 3. Positions --------------------------------------------------------
    MobilityHelper mobility;
    Ptr<ListPositionAllocator> pos = CreateObject<ListPositionAllocator>();
    pos->Add(Vector(0.0, 0.0, 0.0));                              // TX-A
    pos->Add(Vector(linkDist, 0.0, 0.0));                         // RX-B
    pos->Add(Vector(linkDist + interfDist, 0.0, 0.0));            // TX-C
    pos->Add(Vector(2 * linkDist + interfDist, 0.0, 0.0));        // RX-D
    mobility.SetPositionAllocator(pos);
    mobility.SetMobilityModel("ns3::ConstantPositionMobilityModel");
    mobility.Install(nodes);

    // ---- Internet stack ------------------------------------------------------
    InternetStackHelper stack;
    stack.Install(nodes);
    Ipv4AddressHelper addr;
    addr.SetBase("10.1.1.0", "255.255.255.0");
    Ipv4InterfaceContainer ifs = addr.Assign(devices);

    // Pre-fill ARP caches. Otherwise the two ARP broadcasts sent at t=1 s can
    // collide (broadcasts are never retried) and a dead ARP entry silently
    // blocks the whole flow for 100 s, which has nothing to do with the study.
    NeighborCacheHelper neighbors;
    neighbors.PopulateNeighborCache();

    // ---- 4. Primary UDP flow  TX-A -> RX-B ----------------------------------
    UdpServerHelper primaryServer(9);
    ApplicationContainer srvA = primaryServer.Install(nodes.Get(1));
    srvA.Start(Seconds(0.5));
    srvA.Stop(Seconds(simTime + 1.0));

    UdpClientHelper primaryClient(ifs.GetAddress(1), 9);
    primaryClient.SetAttribute("MaxPackets", UintegerValue(0xFFFFFFFF));
    primaryClient.SetAttribute("Interval", TimeValue(Seconds(primaryInt)));
    primaryClient.SetAttribute("PacketSize", UintegerValue(pktSize));
    ApplicationContainer cliA = primaryClient.Install(nodes.Get(0));
    cliA.Start(Seconds(1.0));
    cliA.Stop(Seconds(simTime));

    // ---- 5. Interfering UDP flow  TX-C -> RX-D ------------------------------
    Ptr<UdpServer> interfSrvPtr;
    if (interf)
    {
        UdpServerHelper interfServer(10);
        ApplicationContainer srvC = interfServer.Install(nodes.Get(3));
        srvC.Start(Seconds(0.5));
        srvC.Stop(Seconds(simTime + 1.0));
        interfSrvPtr = DynamicCast<UdpServer>(srvC.Get(0));

        UdpClientHelper interfClient(ifs.GetAddress(3), 10);
        interfClient.SetAttribute("MaxPackets", UintegerValue(0xFFFFFFFF));
        interfClient.SetAttribute("Interval", TimeValue(Seconds(interfInt)));
        interfClient.SetAttribute("PacketSize", UintegerValue(pktSize));
        ApplicationContainer cliC = interfClient.Install(nodes.Get(2));
        // random phase offset so the two CBR sources are not in lock-step
        Ptr<UniformRandomVariable> jitter = CreateObject<UniformRandomVariable>();
        cliC.Start(Seconds(1.0) + MicroSeconds(jitter->GetInteger(1, 1000)));
        cliC.Stop(Seconds(simTime));
    }

    // ---- 6. PCAP tracing -----------------------------------------------------
    if (pcap)
    {
        phy.EnablePcap("lab10-interf", devices);
    }

    // MAC-level counters on the primary transmitter only
    std::string sm = "/NodeList/0/DeviceList/0/$ns3::WifiNetDevice/RemoteStationManager/";
    Config::ConnectWithoutContext(sm + "MacTxDataFailed", MakeCallback(&TxDataFailed));
    Config::ConnectWithoutContext(sm + "MacTxFinalDataFailed", MakeCallback(&TxFinalFailed));

    // ---- 7. Measurement ------------------------------------------------------
    FlowMonitorHelper fmHelper;
    Ptr<FlowMonitor> monitor = fmHelper.InstallAll();

    Simulator::Stop(Seconds(simTime + 1.0));
    Simulator::Run();

    monitor->CheckForLostPackets();
    Ptr<Ipv4FlowClassifier> classifier =
        DynamicCast<Ipv4FlowClassifier>(fmHelper.GetClassifier());

    double active = simTime - 1.0;
    uint64_t pTx = 0, pRx = 0, iTx = 0, iRx = 0;
    double pDelay = 0, pThr = 0, iThr = 0;
    for (auto& [id, st] : monitor->GetFlowStats())
    {
        Ipv4FlowClassifier::FiveTuple t = classifier->FindFlow(id);
        double thr = st.rxBytes * 8.0 / active / 1e6;
        if (t.destinationPort == 9)
        {
            pTx = st.txPackets;
            pRx = st.rxPackets;
            pThr = thr;
            pDelay = st.rxPackets ? st.delaySum.GetSeconds() / st.rxPackets * 1e3 : 0;
        }
        else if (t.destinationPort == 10)
        {
            iTx = st.txPackets;
            iRx = st.rxPackets;
            iThr = thr;
        }
        if (verbose)
        {
            std::cout << "Flow " << id << "  " << t.sourceAddress << ":" << t.sourcePort
                      << " -> " << t.destinationAddress << ":" << t.destinationPort << "\n"
                      << "  Tx packets : " << st.txPackets << "\n"
                      << "  Rx packets : " << st.rxPackets << "\n"
                      << "  Lost       : " << st.txPackets - st.rxPackets << "\n"
                      << std::fixed << std::setprecision(2)
                      << "  PDR        : " << (st.txPackets ? 100.0 * st.rxPackets / st.txPackets : 0)
                      << " %\n"
                      << "  Throughput : " << thr << " Mbit/s\n"
                      << "  Mean delay : "
                      << (st.rxPackets ? st.delaySum.GetSeconds() / st.rxPackets * 1e3 : 0)
                      << " ms\n";
            if (t.destinationPort == 9)
            {
                std::cout << "  MAC retries at TX-A  : " << g_retries << "\n"
                          << "  Retry-limit drops    : " << g_finalFail << "\n";
            }
        }
    }

    double pdr = pTx ? 100.0 * pRx / pTx : 0.0;
    double ipdr = iTx ? 100.0 * iRx / iTx : 0.0;
    // CSV: interfDist,interf,run,pTx,pRx,pdr,thr,delay,iTx,iRx,ipdr,ithr,retries,finalFail
    std::cout << std::fixed << std::setprecision(3) << "CSV," << interfDist << "," << interf
              << "," << run << "," << pTx << "," << pRx << "," << pdr << "," << pThr << ","
              << pDelay << "," << iTx << "," << iRx << "," << ipdr << "," << iThr << ","
              << g_retries << "," << g_finalFail << std::endl;

    if (pcap)
    {
        monitor->SerializeToXmlFile("lab10-flowmon.xml", true, true);
    }
    Simulator::Destroy();
    return 0;
}
