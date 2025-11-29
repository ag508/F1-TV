import asyncio
import websockets
import json
import logging
from livef1.adapters import RealF1Client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('LiveF1Service')

# Store connected clients
connected_clients = set()

# Current state of the race
race_state = {
    'positions': {},
    'telemetry': {}
}

async def register(websocket):
    """Register a new WebSocket client."""
    connected_clients.add(websocket)
    try:
        # Send initial state
        await websocket.send(json.dumps({'type': 'init', 'data': race_state}))
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)

async def broadcast_data(data):
    """Broadcast data to all connected clients."""
    if not connected_clients:
        return

    message = json.dumps(data)
    # Create tasks for all sends so one slow client doesn't block others
    tasks = [asyncio.create_task(client.send(message)) for client in connected_clients]
    await asyncio.gather(*tasks, return_exceptions=True)

async def process_f1_data():
    """Connect to LiveF1 and process data."""
    try:
        logger.info("Starting LiveF1 Client...")

        # Initialize the client with topics we are interested in
        # Position.z: Car positions (x, y, z)
        # CarData.z: Telemetry (speed, rpm, gear, etc.)
        # TimingData: Laptimes, sectors, etc. (if available)
        client = RealF1Client(
            topics=["Position.z", "CarData.z", "TimingStats"],
            log_file_name=None  # specific logging if needed
        )

        @client.callback("Position.z")
        async def handle_position(records):
            # records is a list of entries
            updates = []
            for record in records:
                # Structure depends on LiveF1 output, usually a dict
                # We normalize it for the frontend
                driver_number = str(record.get('RacingNumber', ''))
                if not driver_number: continue

                pos_data = {
                    'x': record.get('X'),
                    'y': record.get('Y'),
                    'z': record.get('Z'),
                    'status': record.get('Status')
                }

                race_state['positions'][driver_number] = pos_data
                updates.append({'driver': driver_number, 'pos': pos_data})

            if updates:
                await broadcast_data({'type': 'positions', 'data': updates})

        @client.callback("CarData.z")
        async def handle_telemetry(records):
            updates = []
            for record in records:
                # CarData.z usually contains channels like [0]RPM, [2]Speed, [3]Gear, [4]Throttle, [5]Brake
                # We need to map the raw channels to meaningful names
                # LiveF1 documentation might clarify channel mapping, but typically:
                # 0: RPM, 2: Speed, 3: Gear, 4: Throttle, 5: Brake
                channels = record.get('Channels', {})
                driver_number = str(record.get('RacingNumber', ''))

                if not driver_number: continue

                telemetry_data = {
                    'rpm': channels.get('0'),
                    'speed': channels.get('2'),
                    'gear': channels.get('3'),
                    'throttle': channels.get('4'),
                    'brake': channels.get('5'),
                    'drs': channels.get('45') # DRS Status often 45 or similar
                }

                race_state['telemetry'][driver_number] = telemetry_data
                updates.append({'driver': driver_number, 'telemetry': telemetry_data})

            if updates:
                await broadcast_data({'type': 'telemetry', 'data': updates})

        # Start the client
        # Note: client.run() is blocking or async depending on implementation.
        # Looking at user provided docs: "client.run()"
        # We need to run it in a way that doesn't block our websocket server.
        # Ideally, we run it in a separate task or thread.
        # Since RealF1Client seems to rely on asyncio, we can await it.

        await client.run()

    except Exception as e:
        logger.error(f"Error in LiveF1 client: {e}")
        # Retry logic could go here

async def main():
    # Start WebSocket Server
    server = await websockets.serve(register, "0.0.0.0", 8765)
    logger.info("WebSocket Server started on port 8765")

    # Start F1 Data Processor
    # We run this as a task
    f1_task = asyncio.create_task(process_f1_data())

    # Keep the server running
    await asyncio.gather(f1_task, server.wait_closed())

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Shutting down...")
